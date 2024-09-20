import {
	type Address,
	BaseError,
	type Chain,
	type EIP1193Provider,
	createClient,
	custom,
	publicActions,
	walletActions,
} from 'viem'
import 'viem/window'

import { BaseConnector, type CombinedClient } from './base.connectors.ts'

export class InjectedConnector extends BaseConnector {
	#cleanup?: () => void

	static async init(chain: Chain): Promise<InjectedConnector> {
		const self = new InjectedConnector('metamask')
		const eth = typeof window !== 'undefined' ? window.ethereum : undefined
		if (!eth) throw new Error('Metamask not found')

		const client = createClient({ chain: chain, transport: custom(eth) })
			.extend(publicActions)
			.extend(walletActions)

		self.#registerEvents(eth)
		self.client.next(client)
		return self
	}

	async connect(): Promise<readonly [Address, CombinedClient]> {
		this.emitState('connecting')
		const client = this.client.value
		try {
			if (!client) throw new Error('Provider not initialized yet!')
			const [address] = await client.requestAddresses()
			await this.#ensureNetwork()
			this.emitState('connected')
			return [address, client] as const
		} catch (e) {
			this.emitState('disconnected')
			if (e instanceof Error) this.emitError(e)
			throw e
		}
	}
	async disconnect(): Promise<void> {
		this.emitState('disconnected')
	}
	async destroy(): Promise<void> {
		super.destroy()
		this.#cleanup?.()
	}
	async resume(): Promise<readonly [Address, CombinedClient]> {
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

	#registerEvents(provider: EIP1193Provider) {
		this.#cleanup?.() // Invoke the last cleanup, if any

		const handler1 = this.genEventHandler('accountsChanged')
		const handler2 = this.genEventHandler('chainChanged')
		const handler3 = this.genEventHandler('connect')
		const handler4 = this.genEventHandler('disconnect')
		const handler5 = this.genEventHandler('message')

		provider.on('accountsChanged', handler1)
		provider.on('chainChanged', handler2)
		provider.on('connect', handler3)
		provider.on('disconnect', handler4)
		provider.on('message', handler5)

		this.#cleanup = () => {
			provider.removeListener('accountsChanged', handler1)
			provider.removeListener('chainChanged', handler2)
			provider.removeListener('connect', handler3)
			provider.removeListener('disconnect', handler4)
			provider.removeListener('message', handler5)
		}
	}
}
