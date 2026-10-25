// Public browser installations never use the private server's credentials.
module.exports = { installAccessControl() {}, installStaticFiles() {}, secretEquals: (a, b) => a === b };
