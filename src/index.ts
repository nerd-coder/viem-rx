import {
	BehaviorSubject,
	catchError,
	combineLatest,
	distinctUntilChanged,
	filter,
	from,
	map,
	merge,
	of,
	share,
	startWith,
	Subject,
	Subscription,
	switchMap,
	tap,
	throttleTime,
	timer,
} from 'rxjs'
import { type Address, getAddress } from 'viem'
import { bscTestnet, type Chain } from 'viem/chains'
import {
	isErrorEvent,
	type BaseConnector,
	type CombinedClient,
	type ConnectionState,
	type ConnectorEvent,
	isAccountChangedEvent,
	isConnectionStateEvent,
	isDisplayQrCodeEvent,
} from './connectors/base.connectors.ts'
import { InjectedConnector } from './connectors/injected.connector.ts'
import { notNull } from './utils/notNull.ts'
import { WalletConnectConnector } from './connectors/walletconnect.connector.ts'
import {
	OPTIONAL_EVENTS,
	OPTIONAL_METHODS,
} from '@walletconnect/ethereum-provider'

const VIEM_RX_KEY_LASTCONNECTION = 'VIEM_RX_KEY_LASTCONNECTION'

interface IViemRxStoreOptions {
	walletconnectProjectId: string
	title: string
	debug: boolean
	chain: Chain
}

export class ViemRxStore {
	#state = {
		account: new Subject<Address | undefined>(),
		error: new BehaviorSubject<Error | undefined>(undefined),
		connector: new BehaviorSubject<BaseConnector | undefined>(undefined),
		watchBalance: new Subject<boolean>(),
	}
	#tapLog = <T>(msg: string) =>
		tap<T>(a => this.#options.debug && console.log('🤖 RXJS:', msg, a))
	#subscription = new Subscription()
	#options: IViemRxStoreOptions

	public readonly subjects = {
		account: new BehaviorSubject<Address | undefined>(undefined),
		error: new BehaviorSubject<Error | undefined>(undefined),
		events: new Subject<ConnectorEvent>(),
		balance: new BehaviorSubject<bigint>(0n),
		client: new BehaviorSubject<CombinedClient | undefined>(undefined),
		connectionState: new BehaviorSubject<ConnectionState>('disconnected'),
		displayUri: new BehaviorSubject<string | undefined>(undefined),
	}
	public pollingInterval = 4000
	public throttlingDuration = 4000

	watchBalance(flag: boolean) {
		this.#state.watchBalance.next(flag)
	}

	constructor(options: IViemRxStoreOptions) {
		this.#options = options
		// Connect the subjects
		const eventsObs = this.#state.connector.pipe(
			filter(notNull),
			switchMap(c => c.events),
			this.#tapLog('Event emitted'),
			share(),
		)
		const accountObs = merge(
			this.#state.account,
			eventsObs.pipe(
				filter(isAccountChangedEvent),
				map(z => z.data[0]),
				map(arr => (arr ? getAddress(arr) : undefined)),
			),
		).pipe(distinctUntilChanged(), this.#tapLog('Account changed'), share())
		const connectionStateObs = merge(
			accountObs.pipe(
				map((a): ConnectionState => (a ? 'connected' : 'disconnected')),
			),
			eventsObs.pipe(
				filter(isConnectionStateEvent),
				map(e => e.data),
			),
		).pipe(distinctUntilChanged(), this.#tapLog('Connection state changed'))
		const balanceObs = combineLatest([
			this.#state.connector.pipe(
				filter(notNull),
				switchMap(z => z.client),
			),
			accountObs,
			this.#state.watchBalance.pipe(startWith(false)),
		]).pipe(
			throttleTime(this.throttlingDuration, undefined, {
				leading: true,
				trailing: true,
			}),
			switchMap(([client, account, watch]) =>
				!client || !account
					? of(0n)
					: watch
					  ? timer(0, this.pollingInterval).pipe(
								this.#tapLog('Watching balance...'),
								switchMap(() => from(client.getBalance({ address: account }))),
								catchError(e => {
									console.warn('Fetch balance failed', e)
									return of(0n)
								}),
						  )
					  : from(client.getBalance({ address: account })).pipe(
								this.#tapLog('Fetching balance...'),
						  ),
			),
			distinctUntilChanged(),
			this.#tapLog('Balance changed'),
		)
		const errorObs = merge(
			this.#state.error,
			eventsObs.pipe(
				filter(isErrorEvent),
				map(e => e.data),
			),
		).pipe(distinctUntilChanged(), this.#tapLog('Error changed'))
		const displayUriObs = merge(
			connectionStateObs.pipe(
				filter(e => e === 'disconnected'),
				map(() => undefined),
			),
			eventsObs.pipe(
				filter(isDisplayQrCodeEvent),
				map(e => e.data),
			),
		).pipe(distinctUntilChanged(), this.#tapLog('Display URI changed'))
		const clientObs = this.#state.connector.pipe(
			filter(notNull),
			switchMap(c => c.client),
			distinctUntilChanged(),
			// this.#tapLog('Client changed')
		)

		// Multicast
		this.#subscription.add(accountObs.subscribe(this.subjects.account))
		this.#subscription.add(errorObs.subscribe(this.subjects.error))
		this.#subscription.add(balanceObs.subscribe(this.subjects.balance))
		this.#subscription.add(clientObs.subscribe(this.subjects.client))
		this.#subscription.add(eventsObs.subscribe(this.subjects.events))
		this.#subscription.add(
			connectionStateObs.subscribe(this.subjects.connectionState),
		)
		this.#subscription.add(displayUriObs.subscribe(this.subjects.displayUri))
	}

	async connect(kind: 'metamask' | 'walletConnect') {
		try {
			this.#state.error.next(undefined)
			switch (kind) {
				case 'metamask': {
					const connector = await this.#getOrCreateConnector(kind)
					const [address, client] = await connector.connect()
					this.#state.account.next(getAddress(address))
					return [address, client] as const
				}
				case 'walletConnect': {
					const connector = await this.#getOrCreateConnector(kind)
					const [address, client] = await connector.connect()
					this.#state.account.next(getAddress(address))
					return [address, client] as const
				}
				default:
					throw new Error('Unsupported connector!')
			}
		} catch (e) {
			if (e instanceof Error) this.#state.error.next(e)
			throw e
		} finally {
			if (!this.#state.error.value)
				localStorage.setItem(VIEM_RX_KEY_LASTCONNECTION, kind)
		}
	}
	async resume() {
		try {
			const connectionType = localStorage.getItem(VIEM_RX_KEY_LASTCONNECTION)
			if (typeof connectionType !== 'string') return
			console.log('🤖 Resuming...', connectionType)

			switch (connectionType) {
				case 'metamask': {
					const connector = await this.#getOrCreateConnector(connectionType)
					const [address, client] = await connector.resume()
					if (!address) return
					this.#state.account.next(getAddress(address))
					console.log('🤖 Resume succeeded, account:', address)
					return [address, client] as const
				}
				case 'walletConnect': {
					const connector = await this.#getOrCreateConnector(connectionType)
					const resumed = await connector.resume()
					if (!resumed) return
					const [address, client] = resumed
					this.#state.account.next(address ? getAddress(address) : undefined)
					console.log('🤖 Resume succeeded, account:', address)
					return [address, client] as const
				}
			}
		} catch (e) {
			console.log('Resume failed', e)
			/* Ignore errors */
		}
	}
	async disconnect() {
		this.#state.account.next(undefined)
		this.#state.error.next(undefined)
		await this.#state.connector.value?.disconnect()
		localStorage.removeItem(VIEM_RX_KEY_LASTCONNECTION)
	}
	clearError() {
		this.#state.error.next(undefined)
	}
	destroy() {
		this.#subscription.unsubscribe()
		for (const subject of Object.values(this.#state)) subject.complete()
		for (const subject of Object.values(this.subjects)) subject.complete()
	}

	async #getOrCreateConnector(kind: 'metamask' | 'walletConnect') {
		const chain = bscTestnet
		let connector = this.#state.connector.value
		if (connector && connector.kind !== kind) {
			await connector.destroy()
			connector = undefined
		}
		if (!connector) {
			switch (kind) {
				case 'metamask':
					connector = await InjectedConnector.init(bscTestnet)
					break
				case 'walletConnect': {
					connector = await WalletConnectConnector.init(
						{
							projectId: this.#options.walletconnectProjectId,
							showQrModal: false,
							chains: [chain.id],
							optionalMethods: OPTIONAL_METHODS,
							optionalEvents: OPTIONAL_EVENTS,
							rpcMap: { [chain.id]: chain.rpcUrls.default.http[0] },
							metadata: {
								name: this.#options.title,
								description: this.#options.title,
								icons: [
									new URL('static/android-chrome-192x192.png', location.origin)
										.href,
								],
								url: location.origin,
							},
						},
						chain,
					)
				}
				break
			}
		}
		this.#state.connector.next(connector)
		return connector
	}
}
