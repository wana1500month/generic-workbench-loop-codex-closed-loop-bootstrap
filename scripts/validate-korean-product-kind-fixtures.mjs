import {
  koreanProjectKindFixtureNames,
  validateProjectKindFixture
} from "./testing/project-kind-fixtures.mjs";

for (const fixtureName of koreanProjectKindFixtureNames) {
  await validateProjectKindFixture(fixtureName);
}

console.log("validate:korean-product-kind-fixtures passed");
