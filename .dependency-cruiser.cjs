/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: "no-circular",
			comment: "No circular dependencies allowed",
			from: {},
			to: { circular: true },
			severity: "error",
		},
		{
			name: "no-client-imports-server",
			comment: "Client code must not import from server",
			from: { path: "src/client/" },
			to: { path: "src/server/" },
			severity: "error",
		},
		{
			name: "no-server-imports-client",
			comment: "Server code must not import from client",
			from: { path: "src/server/" },
			to: { path: "src/client/" },
			severity: "error",
		},
		{
			name: "shared-no-relative-imports",
			comment: "Shared modules should not import from client or server",
			from: { path: "src/shared/" },
			to: { path: "(src/client/|src/server/)" },
			severity: "error",
		},
	],
	options: {
		doNotFollow: {
			path: ["node_modules", "\\.test\\.ts$"],
		},
	},
};
