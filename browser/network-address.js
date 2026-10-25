// Browser requests are subject to the browser's CORS and network policies.
module.exports = { isIP: value => /^[\d.]+$/.test(value) ? 4 : value.includes(':') ? 6 : 0,
    promises: { lookup: async (_host, options) => options?.all ? [] : { address: '', family: 0 } } };
