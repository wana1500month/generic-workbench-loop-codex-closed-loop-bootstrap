import { validateProjectKindFixture } from "./testing/project-kind-fixtures.mjs";

for (const fixtureName of [
  "ko-document-artifact",
  "ko-document-generator",
  "ko-install-guide-generator"
]) {
  await validateProjectKindFixture(fixtureName);
}

console.log("validate:korean-document-artifact-detection passed");
