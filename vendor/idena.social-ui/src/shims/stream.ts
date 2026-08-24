// idena.social uses sax's parser API, which does not require Node streams.
// Keeping Stream undefined deliberately selects sax's browser fallback.
export const Stream = undefined;
