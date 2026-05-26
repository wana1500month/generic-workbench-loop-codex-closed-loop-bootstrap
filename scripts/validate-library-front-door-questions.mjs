import { validateProjectKindFixture } from "./testing/project-kind-fixtures.mjs";

await validateProjectKindFixture("library");
console.log("validate:library-front-door-questions passed");
