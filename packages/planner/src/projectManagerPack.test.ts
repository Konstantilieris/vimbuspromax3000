import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const agentDir = path.join(repoRoot, ".claude", "agents");
const memoryDir = path.join(repoRoot, ".claude", "agent-memory", "project-manager");
const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
const pluginRoot = path.join(repoRoot, "plugins", "taskgoblin-project-manager");
const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const pluginAgentDir = path.join(pluginRoot, "agents");
const pluginSkillDir = path.join(pluginRoot, "skills");
const pluginMcpPath = path.join(pluginRoot, ".mcp.json");
const slackMcpExamplePath = path.join(pluginRoot, "references", "slack-mcp.example.json");

const agentFiles = [
  "project-manager.md",
  "pm-codebase-analyst.md",
  "pm-work-breakdown.md",
  "pm-sprint-planner.md",
  "pm-roadmap-planner.md",
  "pm-jira-operator.md",
];

const committedMemoryFiles = [
  "MEMORY.md",
  "jira-config.template.md",
  "team-defaults.template.md",
  "slack-config.template.md",
];

const localMemoryFiles = [
  "jira-config.md",
  "team-defaults.md",
  "slack-config.md",
];

const forbiddenResidues = [
  "Holocomm",
  "HC",
  "apollonadmin.atlassian.net",
  "Nikos Psycharis",
  "Aggelos Konstantilieris",
  "Booking_Nest",
  "NestJS booking system",
  "LangGraph hierarchical graph",
];

const requiredDocRefs = [
  "README.md",
  "docs/architecture/system-overview.md",
  "docs/architecture/module-map.md",
  "docs/planner/planner-pipeline.md",
  "docs/planner/agent-roles.md",
  "docs/verification/verification-contract.md",
  "docs/execution/api-contract.md",
];

const pluginSkillFolders = [
  "taskgoblin-project-manager",
  "taskgoblin-codebase-analyst",
  "taskgoblin-work-breakdown",
  "taskgoblin-sprint-planner",
  "taskgoblin-roadmap-planner",
  "taskgoblin-jira-operator",
];

describe("project-manager pack smoke test", () => {
  test("commits the full PM agent fleet", async () => {
    for (const file of agentFiles) {
      const fullPath = path.join(agentDir, file);
      const info = await stat(fullPath);

      expect(info.isFile()).toBe(true);
    }
  });

  test("commits only templates plus MEMORY.md in the project-manager memory directory", async () => {
    const filenames = (await readdir(memoryDir))
      .filter((filename) => !localMemoryFiles.includes(filename))
      .sort();

    expect(filenames).toEqual([...committedMemoryFiles].sort());
  });

  test("removes Holocomm-specific residue from prompts and templates", async () => {
    const paths = [
      ...agentFiles.map((file) => path.join(agentDir, file)),
      ...committedMemoryFiles.map((file) => path.join(memoryDir, file)),
    ];

    const content = (await Promise.all(paths.map((file) => readFile(file, "utf8")))).join("\n");

    for (const residue of forbiddenResidues) {
      expect(content).not.toContain(residue);
    }
  });

  test("grounds the agent pack in TaskGoblin docs and paths", async () => {
    const content = (await Promise.all(agentFiles.map((file) => readFile(path.join(agentDir, file), "utf8")))).join(
      "\n",
    );

    for (const ref of requiredDocRefs) {
      expect(content).toContain(ref);
    }

    expect(content).not.toContain("tools/planner/");
    expect(content).not.toContain("docs/_template/");
  });

  test("keeps Jira dry-run-first and Slack config-gated", async () => {
    const jiraPrompt = await readFile(path.join(agentDir, "pm-jira-operator.md"), "utf8");

    expect(jiraPrompt).toContain("If `Mode` is missing, default to `Mode: dry-run`.");
    expect(jiraPrompt).toContain("Only proceed with live Jira writes when the parent explicitly sets `Mode: create`.");
    expect(jiraPrompt).toContain("Slack notifications are optional and config-gated.");
    expect(jiraPrompt).toContain("If a Slack send fails, report a warning. Never roll back Jira creation because of Slack.");
  });

  test("creates the repo-local native Codex plugin manifest", async () => {
    const info = await stat(pluginManifestPath);
    const manifest = JSON.parse(await readFile(pluginManifestPath, "utf8"));

    expect(info.isFile()).toBe(true);
    expect(manifest.name).toBe("taskgoblin-project-manager");
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(manifest.interface.displayName).toBe("TaskGoblin Project Manager");
    expect(manifest.interface.capabilities).toEqual(["Interactive", "Write"]);
  });

  test("registers the native plugin in the repo-local marketplace", async () => {
    const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
    const pluginEntry = marketplace.plugins.find((entry: { name: string }) => entry.name === "taskgoblin-project-manager");

    expect(marketplace.name).toBe("taskgoblin-local");
    expect(marketplace.interface.displayName).toBe("TaskGoblin Local Plugins");
    expect(pluginEntry).toMatchObject({
      name: "taskgoblin-project-manager",
      source: {
        source: "local",
        path: "./plugins/taskgoblin-project-manager",
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_USE",
      },
      category: "Productivity",
    });
  });

  test("mirrors the six .claude agents into the native plugin agents directory exactly", async () => {
    for (const file of agentFiles) {
      const source = await readFile(path.join(agentDir, file), "utf8");
      const mirror = await readFile(path.join(pluginAgentDir, file), "utf8");

      expect(mirror).toBe(source);
    }
  });

  test("commits all six native plugin skills with SKILL.md and openai metadata", async () => {
    for (const skill of pluginSkillFolders) {
      const skillPath = path.join(pluginSkillDir, skill, "SKILL.md");
      const metadataPath = path.join(pluginSkillDir, skill, "agents", "openai.yaml");

      expect((await stat(skillPath)).isFile()).toBe(true);
      expect((await stat(metadataPath)).isFile()).toBe(true);
    }
  });

  test("keeps native plugin artifacts free of Holocomm residue", async () => {
    const pluginPaths = [
      pluginManifestPath,
      pluginMcpPath,
      slackMcpExamplePath,
      marketplacePath,
      ...agentFiles.map((file) => path.join(pluginAgentDir, file)),
      ...pluginSkillFolders.flatMap((skill) => [
        path.join(pluginSkillDir, skill, "SKILL.md"),
        path.join(pluginSkillDir, skill, "agents", "openai.yaml"),
      ]),
    ];

    const content = (await Promise.all(pluginPaths.map((file) => readFile(file, "utf8")))).join("\n");

    for (const residue of forbiddenResidues) {
      expect(content).not.toContain(residue);
    }
  });

  test("ships Atlassian MCP scaffolding and keeps Slack placeholder-only", async () => {
    const mcpConfig = JSON.parse(await readFile(pluginMcpPath, "utf8"));
    const slackExample = await readFile(slackMcpExamplePath, "utf8");

    expect(mcpConfig.mcpServers.atlassian.url).toBe("https://mcp.atlassian.com/v1/mcp");
    expect(mcpConfig.mcpServers.slack).toBeUndefined();
    expect(slackExample).toContain("[TODO: slack-mcp-endpoint]");
    expect(slackExample).toContain("Example only.");
  });

  test("gitignores live local Jira and Slack config files", async () => {
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");

    expect(gitignore).toContain(".claude/agent-memory/project-manager/jira-config.md");
    expect(gitignore).toContain(".claude/agent-memory/project-manager/team-defaults.md");
    expect(gitignore).toContain(".claude/agent-memory/project-manager/slack-config.md");
  });

  test("documents the pack as operator-side rather than runtime behavior", async () => {
    const packDoc = await readFile(path.join(repoRoot, "docs", "planner", "project-manager-pack.md"), "utf8");
    const docIndex = await readFile(path.join(repoRoot, "docs", "README.md"), "utf8");
    const agentRoles = await readFile(path.join(repoRoot, "docs", "planner", "agent-roles.md"), "utf8");

    expect(packDoc).toContain("It is a planning companion for humans operating on this repo.");
    expect(packDoc).toContain("it does not change `packages/planner`");
    expect(packDoc).toContain("`.claude/agents` is the authoring source of truth");
    expect(packDoc).toContain("plugins/taskgoblin-project-manager");
    expect(packDoc).toContain(".agents/plugins/marketplace.json");
    expect(docIndex).toContain("planner/project-manager-pack.md");
    expect(agentRoles).toContain("Operator-Side PM Pack");
  });
});
