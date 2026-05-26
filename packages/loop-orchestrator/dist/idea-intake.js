import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { repoRoot } from "./file-system.js";
export const defaultIdeaPath = join(repoRoot, "IDEA.md");
const extractSection = (markdown, names) => {
    const normalizedNames = new Set(names.map((name) => name.trim().toLowerCase()));
    const lines = markdown.split(/\r?\n/);
    let collecting = false;
    const buffer = [];
    for (const line of lines) {
        const headingMatch = /^##\s+(.+?)\s*$/.exec(line.trim());
        if (headingMatch) {
            const heading = headingMatch[1].trim().toLowerCase();
            if (collecting) {
                break;
            }
            collecting = normalizedNames.has(heading);
            continue;
        }
        if (collecting) {
            buffer.push(line);
        }
    }
    const section = buffer.join("\n").trim();
    return section.length > 0 ? section : undefined;
};
const extractBulletList = (markdown, names) => {
    const section = extractSection(markdown, names);
    if (!section) {
        return [];
    }
    return section
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line))
        .map((line) => line.replace(/^[-*]\s+/, "").trim())
        .filter(Boolean);
};
const extractLeadParagraph = (markdown) => {
    const explicitSummary = extractSection(markdown, ["Summary", "Idea", "Brief", "Prompt"])?.trim();
    if (explicitSummary) {
        return explicitSummary
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .find(Boolean) ?? explicitSummary;
    }
    const withoutTitle = markdown.replace(/^#.*$/m, "").trim();
    return (withoutTitle
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .find((block) => block.length > 0) ??
        "Turn the idea into a generic closed-loop workbench flow.");
};
export const readIdeaBrief = async (path = defaultIdeaPath) => {
    const rawMarkdown = await readFile(path, "utf8");
    const title = rawMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
        basename(path, ".md").replace(/[-_]+/g, " ").trim() ??
        "Generic harness idea";
    return {
        title,
        summary: extractLeadParagraph(rawMarkdown),
        user_goals: extractBulletList(rawMarkdown, ["Goals", "User Goals", "Outcomes"]),
        constraints: extractBulletList(rawMarkdown, ["Constraints", "Guardrails", "Non-goals"]),
        quality_bar: extractBulletList(rawMarkdown, ["Quality Bar", "Acceptance", "Bar"]),
        source_path: path,
        raw_markdown: rawMarkdown
    };
};
//# sourceMappingURL=idea-intake.js.map