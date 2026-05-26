import { validateProjectKindFixture } from "./testing/project-kind-fixtures.mjs";

for (const fixtureName of [
  "ko-data-pipeline-tool",
  "ko-data-pipeline-generator"
]) {
  await validateProjectKindFixture(fixtureName);
}

console.log("validate:korean-data-pipeline-detection passed");
