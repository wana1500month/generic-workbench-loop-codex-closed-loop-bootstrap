import { validateProjectKindFixture } from "./testing/project-kind-fixtures.mjs";

await validateProjectKindFixture("agent-workflow");
console.log("validate:agent-workflow-front-door-questions passed");
