// A feature is on unless the server says false: an older server, or a failed lookup, must not hide anything.
export const featureOn = (features, name) => features?.[name] !== false
