import {
	BaseError,
	createClient,
	custom,
	isAddress,
	publicActions,
	type Chain,
	walletActions,
	ProviderRpcError,
	getAddress,
} from 'viem'
import { bscTestnet } from 'viem/chains'
import Provider, {
	EthereumProvider,
	type EthereumProviderOptions,
} from '@walletconnect/ethereum-provider'

import { BaseConnector } from './base.connectors'

export class WalletConnectConnector extends BaseConnector {
	#cleanup?: () => void
	#provider?: Provider

	static async init(
		config: EthereumProviderOptions,
		chain: Chain = bscTestnet,
	) {
		const self = new WalletConnectConnector('walletConnect')
		const eth = await EthereumProvider.init(config)
		const client = createClient({ chain: chain, transport: custom(eth) })
			.extend(publicActions)
			.extend(walletActions)

		self.#registerEvents(eth)
		self.client.next(client)
		self.#provider = eth
		return self
	}

	async connect() {
		if (!this.#provider) throw new Error('Uninitialized!')
		this.emitState('connecting')
		try {
			await this.#provider.connect()
			const client = this.client.value
			if (!client) throw new Error('Provider not initialized yet!')
			const [address] = await client.requestAddresses()
			if (!address) throw new Error('Failed to connect')
			await this.#ensureNetwork()
			this.emitState('connected')
			return [address, client] as const
		} catch (e) {
			this.emitState('disconnected')
			if (e instanceof Error) this.emitError(e)
			throw e
		}
	}
	async disconnect() {
		this.emitState('disconnected')
		await this.#provider?.disconnect()
	}
	async destroy() {
		super.destroy()
		this.#cleanup?.()
	}
	async resume() {
		this.emitState('connecting')
		try {
			const client = this.client.value
			if (!client) throw new Error('Provider not initialized yet!')
			const [address] = await client.getAddresses()
			if (address) {
				await this.#ensureNetwork()
				this.emitState('connected')
			} else {
				this.emitState('disconnected')
			}
			return [address, client] as const
		} catch (e) {
			this.emitState('disconnected')
			if (e instanceof Error) this.emitError(e)
			throw e
		}
	}

	async #ensureNetwork(): Promise<void> {
		const client = this.client.value
		if (!client) throw new Error('Provider not initialized yet!')
		const { chain } = client
		try {
			if ((await client.getChainId()) !== chain.id)
				await client.switchChain({ id: chain.id })
		} catch (e) {
			if (
				e instanceof BaseError &&
				(e.walk() as unknown as { code: number }).code === 4902
			) {
				await client.addChain({ chain })
				return await this.#ensureNetwork()
			}
			throw e
		}
	}

	#registerEvents(provider: Provider) {
		this.#cleanup?.() // Invoke the last cleanup, if any

		const handler1 = this.genEventHandler('accountsChanged')
		const handler2 = this.genEventHandler('chainChanged')
		const handler3 = this.genEventHandler('connect')
		const handler4 = this.genEventHandler('disconnect')
		const handler5 = this.genEventHandler('message')
		const handler6 = this.genEventHandler('display_uri')

		type WCProviderRpcError = Extract<
			Parameters<Parameters<Provider['on']>[1]>[0],
			Error
		>

		const handler1x = (e: string[]) =>
			handler1(e.filter(isAddress).map(getAddress))
		const handler4x = (e: WCProviderRpcError) =>
			handler4(
				new ProviderRpcError(e, {
					code: e.code,
					shortMessage: e.message,
					data: e.data,
				}),
			)
		const handler4xx = () => handler4(null)

		provider.on('session_delete', handler4xx)
		provider.on('display_uri', handler6)

		provider.on('accountsChanged', handler1x)
		provider.on('chainChanged', handler2)
		provider.on('connect', handler3)
		provider.on('disconnect', handler4x)
		provider.on('message', handler5)

		this.#cleanup = () => {
			provider.removeListener('accountsChanged', handler1x)
			provider.removeListener('chainChanged', handler2)
			provider.removeListener('connect', handler3)
			provider.removeListener('disconnect', handler4x)
			provider.removeListener('message', handler5)
			provider.removeListener('session_delete', handler4xx)
			provider.removeListener('display_uri', handler6)
		}
	}
}
