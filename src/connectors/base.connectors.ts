import { BehaviorSubject, type Observable, Subject } from 'rxjs'
import type {
	Address,
	Chain,
	EIP1193EventMap,
	PublicClient,
	Transport,
	WalletClient,
} from 'viem'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'
export const DEFAULT_CONNECTION_STATE: ConnectionState = 'disconnected' as const

export interface AccountsChangedEvent {
	type: 'accountsChanged'
	data: Parameters<EIP1193EventMap['accountsChanged']>[0]
}
export interface ChainChangedEvent {
	type: 'chainChanged'
	data: Parameters<EIP1193EventMap['chainChanged']>[0]
}
export interface ConnectEvent {
	type: 'connect'
	data: Parameters<EIP1193EventMap['connect']>[0]
}
export interface DisconnectEvent {
	type: 'disconnect'
	data: Parameters<EIP1193EventMap['disconnect']>[0] | null
}
export interface MessageEvent {
	type: 'message'
	data: Parameters<EIP1193EventMap['message']>[0]
}
export interface ErrorEvent {
	type: 'error'
	data: Error
}
export interface ConnectionStateEvent {
	type: 'connectionStateChanged'
	data: ConnectionState
}
export interface DisplayQrCodeEvent {
	type: 'display_uri'
	data: string
}

export type ConnectorEvent =
	| ErrorEvent
	| ConnectionStateEvent
	| AccountsChangedEvent
	| ChainChangedEvent
	| ConnectEvent
	| DisconnectEvent
	| MessageEvent
	| DisplayQrCodeEvent

export const isErrorEvent = (e: ConnectorEvent): e is ErrorEvent =>
	e.type === 'error'
export const isAccountChangedEvent = (
	e: ConnectorEvent,
): e is AccountsChangedEvent => e.type === 'accountsChanged'
export const isChainChangedEvent = (
	e: ConnectorEvent,
): e is ChainChangedEvent => e.type === 'chainChanged'
export const isConnectEvent = (e: ConnectorEvent): e is ConnectEvent =>
	e.type === 'connect'
export const isDisconnectEvent = (e: ConnectorEvent): e is DisconnectEvent =>
	e.type === 'disconnect'
export const isMessageEvent = (e: ConnectorEvent): e is MessageEvent =>
	e.type === 'message'
export const isConnectionStateEvent = (
	e: ConnectorEvent,
): e is ConnectionStateEvent => e.type === 'connectionStateChanged'
export const isDisplayQrCodeEvent = (
	e: ConnectorEvent,
): e is DisplayQrCodeEvent => e.type === 'display_uri'

export type CombinedClient = PublicClient<Transport, Chain> &
	WalletClient<Transport, Chain>

export abstract class BaseConnector {
	#emitter = new Subject<ConnectorEvent>()

	protected constructor(public readonly kind: 'metamask' | 'walletConnect') {}

	public readonly client: BehaviorSubject<CombinedClient | undefined> =
		new BehaviorSubject<CombinedClient | undefined>(undefined)
	public readonly events: Observable<ConnectorEvent> =
		this.#emitter.asObservable()

	abstract connect(): Promise<readonly [Address, CombinedClient]>
	abstract disconnect(): Promise<void>
	abstract resume(): Promise<readonly [Address | undefined, CombinedClient]>
	async destroy(): Promise<void> {
		this.#emitter.complete()
		this.client.complete()
	}
	protected genEventHandler<
		T extends ConnectorEvent['type'],
		E extends ConnectorEvent,
	>(type: T): (data: E extends { type: T; data: infer D } ? D : never) => void {
		return data => this.#emitter.next({ type, data } as ConnectorEvent)
	}

	protected emitError: (data: Error) => void = this.genEventHandler('error')
	protected emitState: (data: ConnectionState) => void = this.genEventHandler(
		'connectionStateChanged',
	)
}
