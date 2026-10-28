import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type ReferenceBundle = {
  scenario: Record<string, unknown>;
  supplier: Record<string, unknown>;
  productsAndRecipes: {
    products: Array<{ id: string; name: string; labour_hours_per_unit: number }>;
    recipes: Array<{ product_id: string; ingredient_id: string; quantity_per_unit: number }>;
  };
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to seed reference data.");

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(resolve("reference-data", filename), "utf8")) as T;
}

async function main() {
  const [scenario, supplier, productsAndRecipes] = await Promise.all([
    readJson<ReferenceBundle["scenario"]>("scenario.json"),
    readJson<ReferenceBundle["supplier"]>("supplier.json"),
    readJson<ReferenceBundle["productsAndRecipes"]>("products_and_recipes.json"),
  ]);

  await prisma.referenceSetting.upsert({
    where: { key: "scenario" },
    create: { key: "scenario", value: scenario as Prisma.InputJsonValue },
    update: { value: scenario as Prisma.InputJsonValue },
  });
  await prisma.referenceSetting.upsert({
    where: { key: "supplier" },
    create: { key: "supplier", value: supplier as Prisma.InputJsonValue },
    update: { value: supplier as Prisma.InputJsonValue },
  });

  for (const product of productsAndRecipes.products) {
    await prisma.product.upsert({
      where: { id: product.id },
      create: {
        id: product.id,
        name: product.name,
        labourHoursPerUnit: product.labour_hours_per_unit,
      },
      update: {
        name: product.name,
        labourHoursPerUnit: product.labour_hours_per_unit,
      },
    });
  }

  const ingredientIds = [...new Set(productsAndRecipes.recipes.map((recipe) => recipe.ingredient_id))];
  for (const id of ingredientIds) {
    await prisma.ingredient.upsert({ where: { id }, create: { id }, update: {} });
  }

  for (const recipe of productsAndRecipes.recipes) {
    await prisma.recipe.upsert({
      where: { productId_ingredientId: { productId: recipe.product_id, ingredientId: recipe.ingredient_id } },
      create: {
        productId: recipe.product_id,
        ingredientId: recipe.ingredient_id,
        quantityPerUnit: recipe.quantity_per_unit,
      },
      update: { quantityPerUnit: recipe.quantity_per_unit },
    });
  }

  console.log(`Seeded scenario, supplier, ${productsAndRecipes.products.length} products and ${productsAndRecipes.recipes.length} recipes.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
