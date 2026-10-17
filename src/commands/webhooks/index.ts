import type { Command } from "@/cli/spec";
import { listenWebhooksCommand } from "@/commands/webhooks/listen";

export const webhooksCommand: Command = {
	name: "webhooks",
	summary: "Test webhooks against a local server",
	description:
		"Webhook endpoints are managed in the dashboard. `listen` relays test events from Reloop to a server running on your machine.",
	commands: [listenWebhooksCommand],
	examples: ["reloop webhooks listen --forward-to localhost:3000/webhooks"],
};
