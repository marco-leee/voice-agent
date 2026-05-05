// src/hooks.server.js
import type { Handle } from "@sveltejs/kit";
export const handle: Handle = async ({ event, resolve }) => {
	// Process the request and generate a response
	const response = await resolve(event);
	// Example: Add custom headers to the response
	response.headers.set("X-Custom-Header", "MyValue");
	return response;
};
