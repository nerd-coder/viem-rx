export const notNull = <T>(a: T): a is NonNullable<T> =>
	typeof a !== 'undefined' && a !== null
