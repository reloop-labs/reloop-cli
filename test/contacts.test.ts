import { describe, expect, test } from "bun:test";
import { run } from "@/cli/run";
import { ExitCode } from "@/errors/cli-error";
import {
	API_KEY,
	contactFixture,
	createTestContext,
	ENDPOINT,
	listFixture,
	mockApi,
	type Route,
	scriptedPrompter,
} from "./helpers";

const env = { RELOOP_API_KEY: API_KEY };

function setup(
	routes: Route[],
	options: { tty?: boolean; answers?: Array<string | boolean> } = {},
) {
	const api = mockApi(routes);
	const ctx = createTestContext({
		env,
		fetch: api.fetch,
		terminal: options.tty
			? { stdinIsTty: true, stdoutIsTty: true, stderrIsTty: true, columns: 100 }
			: {},
		...(options.answers ? { prompter: scriptedPrompter(options.answers) } : {}),
	});
	return { api, ctx };
}

const withEndpoint = (argv: string[]): string[] => [
	...argv,
	"--endpoint",
	ENDPOINT,
];

describe("contacts create", () => {
	test("builds the documented payload from flags", async () => {
		const { api, ctx } = setup([
			{
				method: "POST",
				path: "/api/contacts/create",
				status: 201,
				body: contactFixture({ event: "contact.create" }),
			},
		]);

		const code = await run(
			withEndpoint([
				"contacts",
				"create",
				"--email",
				"luna@example.com",
				"--first-name",
				"Luna",
				"--last-name",
				"Gurnee",
				"--status",
				"subscribed",
				"--property",
				"company=LunarLabs",
				"--property",
				"role=developer",
				"--group-id",
				"grp_1",
				"--channel",
				"chn_1:opt_out",
			]),
			ctx,
		);

		expect(code).toBe(ExitCode.success);
		expect(api.calls[0]?.body).toEqual({
			email: "luna@example.com",
			firstName: "Luna",
			lastName: "Gurnee",
			status: "subscribed",
			properties: { company: "LunarLabs", role: "developer" },
			groupIds: ["grp_1"],
			channels: [{ channelId: "chn_1", subscription: "opt_out" }],
		});
	});

	test("omits every field that was not provided", async () => {
		const { api, ctx } = setup([
			{
				method: "POST",
				path: "/api/contacts/create",
				status: 201,
				body: contactFixture({ event: "e" }),
			},
		]);

		await run(
			withEndpoint(["contacts", "create", "--email", "luna@example.com"]),
			ctx,
		);
		expect(api.calls[0]?.body).toEqual({ email: "luna@example.com" });
	});

	test("defaults a channel with no suffix to opt_in", async () => {
		const { api, ctx } = setup([
			{
				method: "POST",
				path: "/api/contacts/create",
				status: 201,
				body: contactFixture({ event: "e" }),
			},
		]);

		await run(
			withEndpoint([
				"contacts",
				"create",
				"--email",
				"a@b.co",
				"--channel",
				"chn_1",
			]),
			ctx,
		);
		expect(api.calls[0]?.body).toMatchObject({
			channels: [{ channelId: "chn_1", subscription: "opt_in" }],
		});
	});

	test("--properties accepts numbers and --property overrides it", async () => {
		const { api, ctx } = setup([
			{
				method: "POST",
				path: "/api/contacts/create",
				status: 201,
				body: contactFixture({ event: "e" }),
			},
		]);

		await run(
			withEndpoint([
				"contacts",
				"create",
				"--email",
				"a@b.co",
				"--properties",
				'{"seats":5,"plan":"free"}',
				"--property",
				"plan=pro",
			]),
			ctx,
		);
		expect(api.calls[0]?.body).toMatchObject({
			properties: { seats: 5, plan: "pro" },
		});
	});

	test("rejects an invalid email before any request", async () => {
		const { api, ctx } = setup([]);
		expect(
			await run(withEndpoint(["contacts", "create", "--email", "nope"]), ctx),
		).toBe(ExitCode.usage);
		expect(api.calls).toHaveLength(0);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"invalid_email",
		);
	});

	test("rejects malformed property pairs and JSON", async () => {
		const { ctx: a } = setup([]);
		expect(
			await run(
				withEndpoint([
					"contacts",
					"create",
					"--email",
					"a@b.co",
					"--property",
					"novalue",
				]),
				a,
			),
		).toBe(ExitCode.usage);

		const { ctx: b } = setup([]);
		expect(
			await run(
				withEndpoint([
					"contacts",
					"create",
					"--email",
					"a@b.co",
					"--properties",
					"[1]",
				]),
				b,
			),
		).toBe(ExitCode.usage);
	});

	test("fails with missing_email instead of prompting when not a terminal", async () => {
		const { ctx } = setup([]);
		expect(await run(withEndpoint(["contacts", "create"]), ctx)).toBe(
			ExitCode.usage,
		);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"missing_email",
		);
	});

	test("prompts for every field when run bare in a terminal", async () => {
		const { api, ctx } = setup(
			[
				{
					method: "POST",
					path: "/api/contacts/create",
					status: 201,
					body: contactFixture({ event: "e" }),
				},
			],
			{
				tty: true,
				answers: [
					"luna@example.com",
					"Luna",
					"Gurnee",
					true,
					"company",
					"LunarLabs",
					false,
				],
			},
		);

		expect(await run(withEndpoint(["contacts", "create"]), ctx)).toBe(
			ExitCode.success,
		);
		expect(api.calls[0]?.body).toEqual({
			email: "luna@example.com",
			firstName: "Luna",
			lastName: "Gurnee",
			properties: { company: "LunarLabs" },
		});
	});

	test("does not prompt for optional fields once --email is given", async () => {
		const { api, ctx } = setup(
			[
				{
					method: "POST",
					path: "/api/contacts/create",
					status: 201,
					body: contactFixture({ event: "e" }),
				},
			],
			{ tty: true, answers: [] },
		);

		expect(
			await run(withEndpoint(["contacts", "create", "--email", "a@b.co"]), ctx),
		).toBe(ExitCode.success);
		expect(api.calls[0]?.body).toEqual({ email: "a@b.co" });
	});

	test("maps a duplicate contact onto exit code 5", async () => {
		const { ctx } = setup([
			{
				method: "POST",
				path: "/api/contacts/create",
				status: 409,
				body: { message: "Contact already exists", why: "w", fix: "f" },
			},
		]);

		expect(
			await run(withEndpoint(["contacts", "create", "--email", "a@b.co"]), ctx),
		).toBe(ExitCode.conflict);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"contact_already_exists",
		);
	});
});

describe("contacts list", () => {
	test("sends pagination and filter parameters", async () => {
		const { api, ctx } = setup([
			{
				method: "GET",
				path: "/api/contacts/list",
				body: listFixture([contactFixture()]),
			},
		]);

		await run(
			withEndpoint([
				"contacts",
				"list",
				"--limit",
				"50",
				"--page",
				"2",
				"--search",
				"luna",
				"--status",
				"subscribed",
				"--channel",
				"chn_1",
			]),
			ctx,
		);

		const url = new URL(api.calls[0]?.url ?? "");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			page: "2",
			limit: "50",
			search: "luna",
			status: "subscribed",
			channelId: "chn_1",
		});
	});

	test("emits the raw API response as JSON with no decoration on stdout", async () => {
		const body = listFixture([contactFixture()]);
		const { ctx } = setup([
			{ method: "GET", path: "/api/contacts/list", body },
		]);

		await run(withEndpoint(["contacts", "list"]), ctx);
		expect(ctx.stdoutJson<Record<string, unknown>>()).toEqual(body);
		expect(ctx.stderrText()).toBe("");
	});

	test("renders a table and a stderr summary on a terminal", async () => {
		const { ctx } = setup(
			[
				{
					method: "GET",
					path: "/api/contacts/list",
					body: listFixture([
						contactFixture(),
						contactFixture({
							id: "con_2",
							email: "alex@example.com",
							firstName: "Alex",
							lastName: "Example",
						}),
					]),
				},
			],
			{ tty: true },
		);

		await run(withEndpoint(["contacts", "list"]), ctx);
		const stdout = ctx.stdoutText();
		expect(stdout).toContain("EMAIL");
		expect(stdout).toContain("luna@example.com");
		expect(stdout).toContain("Alex Example");
		expect(stdout).not.toContain("{");
		expect(ctx.stderrText()).toContain("2 of 2 matching");
	});

	test("suppresses stderr hints with --quiet", async () => {
		const { ctx } = setup(
			[
				{
					method: "GET",
					path: "/api/contacts/list",
					body: listFixture([contactFixture()]),
				},
			],
			{ tty: true },
		);

		await run(withEndpoint(["contacts", "list", "--quiet"]), ctx);
		expect(ctx.stderrText()).toBe("");
		expect(ctx.stdoutJson()).toBeTruthy();
	});

	test("--all walks every page", async () => {
		const first = listFixture(
			Array.from({ length: 100 }, (_, index) =>
				contactFixture({ id: `con_${index}` }),
			),
			{ total: 150, limit: 100 },
		);
		const second = listFixture(
			Array.from({ length: 50 }, (_, index) =>
				contactFixture({ id: `con_1${index}` }),
			),
			{ total: 150, page: 2, limit: 100 },
		);
		const { api, ctx } = setup([
			{ method: "GET", path: "/api/contacts/list", body: first },
			{ method: "GET", path: "/api/contacts/list", body: second },
		]);

		await run(withEndpoint(["contacts", "list", "--all"]), ctx);
		expect(api.calls).toHaveLength(2);
		expect(ctx.stdoutJson<{ contacts: unknown[] }>().contacts).toHaveLength(
			150,
		);
	});

	test("rejects --all combined with --page", async () => {
		const { ctx } = setup([]);
		expect(
			await run(
				withEndpoint(["contacts", "list", "--all", "--page", "2"]),
				ctx,
			),
		).toBe(ExitCode.usage);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"conflicting_options",
		);
	});
});

describe("contacts get", () => {
	test("retrieves directly when given an ID", async () => {
		const { api, ctx } = setup([
			{
				method: "GET",
				path: "/api/contacts/retrieve/con_123",
				body: contactFixture(),
			},
		]);

		expect(await run(withEndpoint(["contacts", "get", "con_123"]), ctx)).toBe(
			ExitCode.success,
		);
		expect(api.calls).toHaveLength(1);
	});

	test("resolves an email through search with an exact match", async () => {
		const { api, ctx } = setup([
			{
				method: "GET",
				path: "/api/contacts/list",
				body: listFixture([
					contactFixture({ id: "con_other", email: "luna@example.com.au" }),
					contactFixture({ id: "con_123", email: "Luna@Example.com" }),
				]),
			},
		]);

		expect(
			await run(withEndpoint(["contacts", "get", "luna@example.com"]), ctx),
		).toBe(ExitCode.success);
		expect(new URL(api.calls[0]?.url ?? "").searchParams.get("search")).toBe(
			"luna@example.com",
		);
		expect(ctx.stdoutJson<{ id: string }>().id).toBe("con_123");
	});

	test("reports contact_not_found when no email matches exactly", async () => {
		const { ctx } = setup([
			{ method: "GET", path: "/api/contacts/list", body: listFixture([]) },
		]);

		expect(
			await run(withEndpoint(["contacts", "get", "nobody@example.com"]), ctx),
		).toBe(ExitCode.notFound);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"contact_not_found",
		);
	});
});

describe("contacts update", () => {
	test("sends only the fields that changed", async () => {
		const { api, ctx } = setup([
			{
				method: "PATCH",
				path: "/api/contacts/con_123",
				body: contactFixture({ event: "e" }),
			},
		]);

		await run(
			withEndpoint([
				"contacts",
				"update",
				"con_123",
				"--status",
				"unsubscribed",
			]),
			ctx,
		);
		expect(api.calls[0]?.body).toEqual({ status: "unsubscribed" });
	});

	test("merges --property into the contact's existing properties", async () => {
		const { api, ctx } = setup([
			{
				method: "GET",
				path: "/api/contacts/retrieve/con_123",
				body: contactFixture({
					properties: { company: "LunarLabs", role: "dev" },
				}),
			},
			{
				method: "PATCH",
				path: "/api/contacts/con_123",
				body: contactFixture({ event: "e" }),
			},
		]);

		await run(
			withEndpoint(["contacts", "update", "con_123", "--property", "plan=pro"]),
			ctx,
		);
		expect(api.calls[1]?.body).toEqual({
			properties: { company: "LunarLabs", role: "dev", plan: "pro" },
		});
	});

	test("--unset-property removes one key and keeps the rest", async () => {
		const { api, ctx } = setup([
			{
				method: "GET",
				path: "/api/contacts/retrieve/con_123",
				body: contactFixture({
					properties: { company: "LunarLabs", role: "dev" },
				}),
			},
			{
				method: "PATCH",
				path: "/api/contacts/con_123",
				body: contactFixture({ event: "e" }),
			},
		]);

		await run(
			withEndpoint([
				"contacts",
				"update",
				"con_123",
				"--unset-property",
				"role",
			]),
			ctx,
		);
		expect(api.calls[1]?.body).toEqual({
			properties: { company: "LunarLabs" },
		});
	});

	test("--properties replaces the whole set without reading the contact first", async () => {
		const { api, ctx } = setup([
			{
				method: "PATCH",
				path: "/api/contacts/con_123",
				body: contactFixture({ event: "e" }),
			},
		]);

		await run(
			withEndpoint([
				"contacts",
				"update",
				"con_123",
				"--properties",
				'{"plan":"pro"}',
			]),
			ctx,
		);
		expect(api.calls).toHaveLength(1);
		expect(api.calls[0]?.body).toEqual({ properties: { plan: "pro" } });
	});

	test("refuses to mix --properties with --property", async () => {
		const { ctx } = setup([]);
		expect(
			await run(
				withEndpoint([
					"contacts",
					"update",
					"con_123",
					"--properties",
					"{}",
					"--property",
					"a=b",
				]),
				ctx,
			),
		).toBe(ExitCode.usage);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"conflicting_options",
		);
	});

	test("refuses an update with no changes", async () => {
		const { api, ctx } = setup([]);
		expect(
			await run(withEndpoint(["contacts", "update", "con_123"]), ctx),
		).toBe(ExitCode.usage);
		expect(api.calls).toHaveLength(0);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"nothing_to_update",
		);
	});

	test("rejects property names the update endpoint cannot accept", async () => {
		const { ctx } = setup([]);
		expect(
			await run(
				withEndpoint([
					"contacts",
					"update",
					"con_123",
					"--property",
					"plan2=pro",
				]),
				ctx,
			),
		).toBe(ExitCode.usage);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"invalid_property",
		);
	});
});

describe("contacts delete", () => {
	test("requires --yes when there is no terminal", async () => {
		const { api, ctx } = setup([]);
		expect(
			await run(withEndpoint(["contacts", "delete", "con_123"]), ctx),
		).toBe(ExitCode.usage);
		expect(api.calls).toHaveLength(0);
		expect(ctx.stderrJson<{ error: { code: string } }>().error.code).toBe(
			"confirmation_required",
		);
	});

	test("deletes without prompting when --yes is passed", async () => {
		const { api, ctx } = setup([
			{
				method: "DELETE",
				path: "/api/contacts/con_123",
				body: {
					success: true,
					object: "contact",
					id: "con_123",
					event: "contact.delete",
				},
			},
		]);

		expect(
			await run(withEndpoint(["contacts", "delete", "con_123", "--yes"]), ctx),
		).toBe(ExitCode.success);
		expect(api.calls[0]?.method).toBe("DELETE");
	});

	test("asks for confirmation on a terminal and deletes when accepted", async () => {
		const { api, ctx } = setup(
			[
				{
					method: "DELETE",
					path: "/api/contacts/con_123",
					body: { success: true, object: "contact", id: "con_123", event: "e" },
				},
			],
			{ tty: true, answers: [true] },
		);

		expect(
			await run(withEndpoint(["contacts", "delete", "con_123"]), ctx),
		).toBe(ExitCode.success);
		expect(api.calls).toHaveLength(1);
	});

	test("exits 130 and sends nothing when the confirmation is declined", async () => {
		const { api, ctx } = setup([], { tty: true, answers: [false] });

		expect(
			await run(withEndpoint(["contacts", "delete", "con_123"]), ctx),
		).toBe(ExitCode.cancelled);
		expect(api.calls).toHaveLength(0);
	});

	test("resolves an email to an ID before deleting", async () => {
		const { api, ctx } = setup([
			{
				method: "GET",
				path: "/api/contacts/list",
				body: listFixture([
					contactFixture({ id: "con_123", email: "luna@example.com" }),
				]),
			},
			{
				method: "DELETE",
				path: "/api/contacts/con_123",
				body: { success: true, object: "contact", id: "con_123", event: "e" },
			},
		]);

		expect(
			await run(
				withEndpoint(["contacts", "delete", "luna@example.com", "--yes"]),
				ctx,
			),
		).toBe(ExitCode.success);
		expect(api.calls[1]?.url).toBe(`${ENDPOINT}/api/contacts/con_123`);
	});
});
