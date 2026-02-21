/**
 * OpenAPI path definitions for recipe and meal log endpoints.
 * Routes: POST /api/recipes, GET /api/recipes, GET /api/recipes/:id,
 *         PATCH /api/recipes/:id, DELETE /api/recipes/:id,
 *         POST /api/recipes/:id/to-shopping-list,
 *         POST /api/meal-log, GET /api/meal-log, GET /api/meal-log/stats,
 *         GET /api/meal-log/:id, PATCH /api/meal-log/:id, DELETE /api/meal-log/:id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

export function recipesMealsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Recipes', description: 'Recipe management with ingredients, steps, and shopping list integration' },
      { name: 'MealLog', description: 'Meal logging and dietary statistics' },
    ],
    schemas: {
      Recipe: {
        type: 'object',
        required: ['id', 'title', 'is_favourite', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the recipe',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          title: {
            type: 'string',
            description: 'Name of the recipe',
            example: 'Chicken Parmesan',
          },
          description: {
            type: 'string',
            nullable: true,
            description: 'Brief description of the recipe',
            example: 'Classic Italian-American chicken parmesan with marinara sauce and melted mozzarella',
          },
          source_url: {
            type: 'string',
            nullable: true,
            description: 'URL where the recipe was originally found',
            example: 'https://www.example.com/recipes/chicken-parmesan',
          },
          source_name: {
            type: 'string',
            nullable: true,
            description: 'Name of the recipe source (e.g., cookbook, website)',
            example: 'Family Cookbook',
          },
          prep_time_min: {
            type: 'integer',
            nullable: true,
            description: 'Preparation time in minutes',
            example: 20,
          },
          cook_time_min: {
            type: 'integer',
            nullable: true,
            description: 'Cooking time in minutes',
            example: 35,
          },
          total_time_min: {
            type: 'integer',
            nullable: true,
            description: 'Total time from start to finish in minutes',
            example: 55,
          },
          servings: {
            type: 'integer',
            nullable: true,
            description: 'Number of servings the recipe makes',
            example: 4,
          },
          difficulty: {
            type: 'string',
            nullable: true,
            description: 'Difficulty level of the recipe',
            example: 'medium',
          },
          cuisine: {
            type: 'string',
            nullable: true,
            description: 'Cuisine type (e.g., Italian, Mexican, Japanese)',
            example: 'Italian',
          },
          meal_type: {
            type: 'array',
            items: { type: 'string' },
            description: 'Meal types this recipe is suitable for',
            example: ['dinner', 'lunch'],
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization and search',
            example: ['chicken', 'comfort-food', 'baked'],
          },
          rating: {
            type: 'number',
            nullable: true,
            description: 'User rating from 0 to 5',
            example: 4.5,
          },
          notes: {
            type: 'string',
            nullable: true,
            description: 'Personal notes about the recipe',
            example: 'Kids love this one. Double the sauce next time.',
          },
          is_favourite: {
            type: 'boolean',
            description: 'Whether the recipe is marked as a favourite',
            example: true,
          },
          image_s3_key: {
            type: 'string',
            nullable: true,
            description: 'S3 key for the recipe image',
            example: 'recipes/chicken-parmesan-hero.jpg',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the recipe was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the recipe was last updated',
            example: '2026-02-21T15:00:00Z',
          },
        },
      },
      RecipeIngredient: {
        type: 'object',
        required: ['id', 'recipe_id', 'name', 'is_optional', 'sort_order'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the ingredient entry',
            example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
          },
          recipe_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the recipe this ingredient belongs to',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          name: {
            type: 'string',
            description: 'Name of the ingredient',
            example: 'chicken breast',
          },
          quantity: {
            type: 'string',
            nullable: true,
            description: 'Amount of the ingredient needed',
            example: '500g',
          },
          unit: {
            type: 'string',
            nullable: true,
            description: 'Unit of measurement',
            example: 'grams',
          },
          category: {
            type: 'string',
            nullable: true,
            description: 'Ingredient category for shopping list grouping',
            example: 'meat',
          },
          is_optional: {
            type: 'boolean',
            description: 'Whether the ingredient is optional',
            example: false,
          },
          notes: {
            type: 'string',
            nullable: true,
            description: 'Additional notes about the ingredient',
            example: 'boneless, skinless',
          },
          sort_order: {
            type: 'integer',
            description: 'Display order within the ingredient list',
            example: 1,
          },
        },
      },
      RecipeStep: {
        type: 'object',
        required: ['id', 'recipe_id', 'step_number', 'instruction'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the step',
            example: 'e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b',
          },
          recipe_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the recipe this step belongs to',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          step_number: {
            type: 'integer',
            description: 'Sequential step number for ordering',
            example: 1,
          },
          instruction: {
            type: 'string',
            description: 'The step instruction text',
            example: 'Pound chicken breasts to even thickness, about 1cm. Season with salt and pepper.',
          },
          duration_min: {
            type: 'integer',
            nullable: true,
            description: 'Estimated duration of this step in minutes',
            example: 5,
          },
          image_s3_key: {
            type: 'string',
            nullable: true,
            description: 'S3 key for an image illustrating this step',
            example: 'recipes/chicken-parmesan-step1.jpg',
          },
        },
      },
      MealLogEntry: {
        type: 'object',
        required: ['id', 'meal_date', 'meal_type', 'title', 'source', 'leftovers_stored', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the meal log entry',
            example: 'f1a2b3c4-d5e6-7f8a-9b0c-d1e2f3a4b5c6',
          },
          meal_date: {
            type: 'string',
            format: 'date',
            description: 'Date the meal was consumed',
            example: '2026-02-21',
          },
          meal_type: {
            type: 'string',
            description: 'Type of meal (e.g., breakfast, lunch, dinner, snack)',
            example: 'dinner',
          },
          title: {
            type: 'string',
            description: 'Name or title of the meal',
            example: 'Chicken Parmesan with side salad',
          },
          source: {
            type: 'string',
            description: 'How the meal was sourced (e.g., home-cooked, takeaway, restaurant)',
            example: 'home-cooked',
          },
          recipe_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Reference to the recipe used, if applicable',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          order_ref: {
            type: 'string',
            nullable: true,
            description: 'Order reference number for takeaway or delivery',
            example: 'UE-12345',
          },
          restaurant: {
            type: 'string',
            nullable: true,
            description: 'Name of the restaurant if dining out or ordering',
            example: 'Mario\'s Italian Kitchen',
          },
          cuisine: {
            type: 'string',
            nullable: true,
            description: 'Cuisine type of the meal',
            example: 'Italian',
          },
          who_ate: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of people who ate the meal',
            example: ['Troy', 'Sarah', 'Kids'],
          },
          who_cooked: {
            type: 'string',
            nullable: true,
            description: 'Name of the person who cooked the meal',
            example: 'Troy',
          },
          rating: {
            type: 'number',
            nullable: true,
            description: 'Meal rating from 0 to 5',
            example: 4.0,
          },
          notes: {
            type: 'string',
            nullable: true,
            description: 'Personal notes about the meal',
            example: 'Used the new parmesan from the deli. Much better flavour.',
          },
          leftovers_stored: {
            type: 'boolean',
            description: 'Whether leftovers from this meal were stored in the pantry',
            example: true,
          },
          image_s3_key: {
            type: 'string',
            nullable: true,
            description: 'S3 key for a photo of the meal',
            example: 'meals/2026-02-21-dinner.jpg',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the meal log entry was created',
            example: '2026-02-21T19:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the meal log entry was last updated',
            example: '2026-02-21T19:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/recipes': {
        post: {
          operationId: 'createRecipe',
          summary: 'Create a recipe',
          description: 'Creates a new recipe with optional ingredients and steps in a single request.',
          tags: ['Recipes'],
          requestBody: jsonBody({
            type: 'object',
            required: ['title'],
            properties: {
              title: {
                type: 'string',
                description: 'Name of the recipe',
                example: 'Chicken Parmesan',
              },
              description: {
                type: 'string',
                description: 'Brief description of the recipe',
                example: 'Classic Italian-American chicken parmesan with marinara and mozzarella',
              },
              source_url: {
                type: 'string',
                description: 'URL where the recipe was found',
                example: 'https://www.example.com/recipes/chicken-parmesan',
              },
              source_name: {
                type: 'string',
                description: 'Name of the recipe source',
                example: 'Family Cookbook',
              },
              prep_time_min: {
                type: 'integer',
                description: 'Preparation time in minutes',
                example: 20,
              },
              cook_time_min: {
                type: 'integer',
                description: 'Cooking time in minutes',
                example: 35,
              },
              total_time_min: {
                type: 'integer',
                description: 'Total time in minutes',
                example: 55,
              },
              servings: {
                type: 'integer',
                description: 'Number of servings',
                example: 4,
              },
              difficulty: {
                type: 'string',
                description: 'Difficulty level',
                example: 'medium',
              },
              cuisine: {
                type: 'string',
                description: 'Cuisine type',
                example: 'Italian',
              },
              meal_type: {
                type: 'array',
                items: { type: 'string' },
                description: 'Meal types this recipe is suitable for',
                example: ['dinner'],
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorization',
                example: ['chicken', 'comfort-food'],
              },
              rating: {
                type: 'number',
                description: 'Initial rating from 0 to 5',
                example: 4.5,
              },
              notes: {
                type: 'string',
                description: 'Personal notes',
                example: 'From grandma\'s recipe box',
              },
              is_favourite: {
                type: 'boolean',
                description: 'Mark as favourite',
                example: false,
              },
              image_s3_key: {
                type: 'string',
                description: 'S3 key for the recipe image',
                example: 'recipes/chicken-parmesan-hero.jpg',
              },
              ingredients: {
                type: 'array',
                description: 'List of ingredients for the recipe',
                items: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Ingredient name',
                      example: 'chicken breast',
                    },
                    quantity: {
                      type: 'string',
                      description: 'Amount needed',
                      example: '500g',
                    },
                    unit: {
                      type: 'string',
                      description: 'Unit of measurement',
                      example: 'grams',
                    },
                    category: {
                      type: 'string',
                      description: 'Ingredient category for shopping grouping',
                      example: 'meat',
                    },
                    is_optional: {
                      type: 'boolean',
                      description: 'Whether the ingredient is optional',
                      example: false,
                    },
                    notes: {
                      type: 'string',
                      description: 'Notes about the ingredient',
                      example: 'boneless, skinless',
                    },
                    sort_order: {
                      type: 'integer',
                      description: 'Display order',
                      example: 1,
                    },
                  },
                },
              },
              steps: {
                type: 'array',
                description: 'Ordered list of cooking steps',
                items: {
                  type: 'object',
                  required: ['instruction'],
                  properties: {
                    step_number: {
                      type: 'integer',
                      description: 'Step number (auto-assigned if omitted)',
                      example: 1,
                    },
                    instruction: {
                      type: 'string',
                      description: 'Step instruction text',
                      example: 'Pound chicken breasts to even thickness. Season with salt and pepper.',
                    },
                    duration_min: {
                      type: 'integer',
                      description: 'Estimated time for this step in minutes',
                      example: 5,
                    },
                    image_s3_key: {
                      type: 'string',
                      description: 'S3 key for step image',
                      example: 'recipes/chicken-parmesan-step1.jpg',
                    },
                  },
                },
              },
            },
          }),
          responses: {
            '201': jsonResponse('Recipe created', {
              type: 'object',
              allOf: [
                { $ref: '#/components/schemas/Recipe' },
                {
                  type: 'object',
                  properties: {
                    ingredients: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/RecipeIngredient' },
                      description: 'List of ingredients included in the recipe',
                    },
                    steps: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/RecipeStep' },
                      description: 'Ordered list of cooking steps',
                    },
                  },
                },
              ],
            }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listRecipes',
          summary: 'List recipes',
          description: 'Returns recipes with optional filtering by cuisine, tag, meal type, difficulty, or favourites.',
          tags: ['Recipes'],
          parameters: [
            {
              name: 'cuisine',
              in: 'query',
              description: 'Filter by cuisine type',
              schema: { type: 'string' },
              example: 'Italian',
            },
            {
              name: 'tag',
              in: 'query',
              description: 'Filter by tag (exact match)',
              schema: { type: 'string' },
              example: 'chicken',
            },
            {
              name: 'meal_type',
              in: 'query',
              description: 'Filter by meal type (e.g., breakfast, lunch, dinner)',
              schema: { type: 'string' },
              example: 'dinner',
            },
            {
              name: 'difficulty',
              in: 'query',
              description: 'Filter by difficulty level',
              schema: { type: 'string' },
              example: 'easy',
            },
            {
              name: 'favourites',
              in: 'query',
              description: 'When true, only return favourite recipes',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'true',
            },
          ],
          responses: {
            '200': jsonResponse('Recipes', {
              type: 'object',
              required: ['recipes'],
              properties: {
                recipes: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Recipe' },
                  description: 'Array of recipes matching the filters',
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/recipes/{id}': {
        get: {
          operationId: 'getRecipe',
          summary: 'Get a recipe with ingredients and steps',
          description: 'Returns a recipe with its ingredients (ordered by sort_order) and steps (ordered by step_number).',
          tags: ['Recipes'],
          parameters: [uuidParam('id', 'Recipe ID')],
          responses: {
            '200': jsonResponse('Recipe with details', {
              type: 'object',
              allOf: [
                { $ref: '#/components/schemas/Recipe' },
                {
                  type: 'object',
                  properties: {
                    ingredients: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/RecipeIngredient' },
                      description: 'List of ingredients ordered by sort_order',
                    },
                    steps: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/RecipeStep' },
                      description: 'List of cooking steps ordered by step_number',
                    },
                  },
                },
              ],
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateRecipe',
          summary: 'Update a recipe',
          description: 'Updates recipe metadata fields. Does not update ingredients or steps.',
          tags: ['Recipes'],
          parameters: [uuidParam('id', 'Recipe ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Updated recipe name',
                example: 'Chicken Parmesan Deluxe',
              },
              description: {
                type: 'string',
                description: 'Updated description',
                example: 'Upgraded version with fresh basil and homemade sauce',
              },
              source_url: {
                type: 'string',
                description: 'Updated source URL',
                example: 'https://www.example.com/recipes/chicken-parmesan-v2',
              },
              source_name: {
                type: 'string',
                description: 'Updated source name',
                example: 'Chef John',
              },
              prep_time_min: {
                type: 'integer',
                description: 'Updated prep time in minutes',
                example: 25,
              },
              cook_time_min: {
                type: 'integer',
                description: 'Updated cook time in minutes',
                example: 40,
              },
              total_time_min: {
                type: 'integer',
                description: 'Updated total time in minutes',
                example: 65,
              },
              servings: {
                type: 'integer',
                description: 'Updated number of servings',
                example: 6,
              },
              difficulty: {
                type: 'string',
                description: 'Updated difficulty level',
                example: 'hard',
              },
              cuisine: {
                type: 'string',
                description: 'Updated cuisine type',
                example: 'Italian-American',
              },
              meal_type: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated meal types',
                example: ['dinner', 'special-occasion'],
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated tags',
                example: ['chicken', 'baked', 'cheese'],
              },
              rating: {
                type: 'number',
                description: 'Updated rating',
                example: 5.0,
              },
              notes: {
                type: 'string',
                description: 'Updated notes',
                example: 'Best version yet. Use San Marzano tomatoes.',
              },
              is_favourite: {
                type: 'boolean',
                description: 'Updated favourite status',
                example: true,
              },
              image_s3_key: {
                type: 'string',
                description: 'Updated S3 key for image',
                example: 'recipes/chicken-parmesan-v2.jpg',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated recipe', { $ref: '#/components/schemas/Recipe' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteRecipe',
          summary: 'Delete a recipe',
          description: 'Deletes a recipe and its ingredients and steps (cascade).',
          tags: ['Recipes'],
          parameters: [uuidParam('id', 'Recipe ID')],
          responses: {
            '204': { description: 'Recipe deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/recipes/{id}/to-shopping-list': {
        post: {
          operationId: 'recipeToShoppingList',
          summary: 'Push recipe ingredients to a shopping list',
          description: 'Adds all ingredients from a recipe as items on the specified shopping list.',
          tags: ['Recipes'],
          parameters: [uuidParam('id', 'Recipe ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['list_id'],
            properties: {
              list_id: {
                type: 'string',
                format: 'uuid',
                description: 'Target shopping list ID to add ingredients to',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Items added', {
              type: 'object',
              required: ['added'],
              properties: {
                added: {
                  type: 'integer',
                  description: 'Number of ingredients added to the shopping list',
                  example: 8,
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/meal-log': {
        post: {
          operationId: 'logMeal',
          summary: 'Log a meal',
          description: 'Creates a meal log entry. Requires title, meal_date, meal_type, and source.',
          tags: ['MealLog'],
          requestBody: jsonBody({
            type: 'object',
            required: ['title', 'meal_date', 'meal_type', 'source'],
            properties: {
              title: {
                type: 'string',
                description: 'Name or title of the meal',
                example: 'Chicken Parmesan with side salad',
              },
              meal_date: {
                type: 'string',
                format: 'date',
                description: 'Date the meal was consumed',
                example: '2026-02-21',
              },
              meal_type: {
                type: 'string',
                description: 'Type of meal (e.g., breakfast, lunch, dinner, snack)',
                example: 'dinner',
              },
              source: {
                type: 'string',
                description: 'How the meal was sourced (e.g., home-cooked, takeaway, restaurant)',
                example: 'home-cooked',
              },
              recipe_id: {
                type: 'string',
                format: 'uuid',
                description: 'Reference to the recipe used, if applicable',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              order_ref: {
                type: 'string',
                description: 'Order reference for takeaway or delivery',
                example: 'UE-12345',
              },
              restaurant: {
                type: 'string',
                description: 'Restaurant name if dining out',
                example: 'Mario\'s Italian Kitchen',
              },
              cuisine: {
                type: 'string',
                description: 'Cuisine type',
                example: 'Italian',
              },
              who_ate: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of people who ate the meal',
                example: ['Troy', 'Sarah'],
              },
              who_cooked: {
                type: 'string',
                description: 'Name of the person who cooked',
                example: 'Troy',
              },
              rating: {
                type: 'number',
                description: 'Rating from 0 to 5',
                example: 4.0,
              },
              notes: {
                type: 'string',
                description: 'Notes about the meal',
                example: 'Used fresh mozzarella, turned out great',
              },
              leftovers_stored: {
                type: 'boolean',
                default: false,
                description: 'Whether leftovers were stored',
                example: true,
              },
              image_s3_key: {
                type: 'string',
                description: 'S3 key for a photo of the meal',
                example: 'meals/2026-02-21-dinner.jpg',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Meal logged', { $ref: '#/components/schemas/MealLogEntry' }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listMeals',
          summary: 'List meal log entries',
          description: 'Returns meal log entries with optional filtering by cuisine, source, meal type, or date range.',
          tags: ['MealLog'],
          parameters: [
            {
              name: 'cuisine',
              in: 'query',
              description: 'Filter by cuisine type',
              schema: { type: 'string' },
              example: 'Italian',
            },
            {
              name: 'source',
              in: 'query',
              description: 'Filter by meal source (e.g., home-cooked, takeaway)',
              schema: { type: 'string' },
              example: 'home-cooked',
            },
            {
              name: 'meal_type',
              in: 'query',
              description: 'Filter by meal type (e.g., breakfast, lunch, dinner)',
              schema: { type: 'string' },
              example: 'dinner',
            },
            {
              name: 'days',
              in: 'query',
              description: 'Filter to meals within the last N days',
              schema: { type: 'integer' },
              example: 7,
            },
          ],
          responses: {
            '200': jsonResponse('Meals', {
              type: 'object',
              required: ['meals'],
              properties: {
                meals: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/MealLogEntry' },
                  description: 'Array of meal log entries matching the filters',
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/meal-log/stats': {
        get: {
          operationId: 'getMealStats',
          summary: 'Get meal statistics',
          description: 'Returns meal statistics including total count, breakdown by source, and breakdown by cuisine over a configurable number of days.',
          tags: ['MealLog'],
          parameters: [
            {
              name: 'days',
              in: 'query',
              description: 'Number of days to include in the statistics window',
              schema: { type: 'integer', default: 30 },
              example: 30,
            },
          ],
          responses: {
            '200': jsonResponse('Meal statistics', {
              type: 'object',
              required: ['total', 'days', 'by_source', 'by_cuisine'],
              properties: {
                total: {
                  type: 'integer',
                  description: 'Total number of meals logged in the period',
                  example: 42,
                },
                days: {
                  type: 'integer',
                  description: 'Number of days covered by the statistics',
                  example: 30,
                },
                by_source: {
                  type: 'array',
                  description: 'Meal count breakdown by source',
                  items: {
                    type: 'object',
                    required: ['source', 'count'],
                    properties: {
                      source: {
                        type: 'string',
                        description: 'Meal source category',
                        example: 'home-cooked',
                      },
                      count: {
                        type: 'integer',
                        description: 'Number of meals from this source',
                        example: 28,
                      },
                    },
                  },
                },
                by_cuisine: {
                  type: 'array',
                  description: 'Meal count breakdown by cuisine',
                  items: {
                    type: 'object',
                    required: ['cuisine', 'count'],
                    properties: {
                      cuisine: {
                        type: 'string',
                        description: 'Cuisine type',
                        example: 'Italian',
                      },
                      count: {
                        type: 'integer',
                        description: 'Number of meals of this cuisine',
                        example: 12,
                      },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/meal-log/{id}': {
        get: {
          operationId: 'getMeal',
          summary: 'Get a meal log entry',
          description: 'Returns a single meal log entry by ID.',
          tags: ['MealLog'],
          parameters: [uuidParam('id', 'Meal log entry ID')],
          responses: {
            '200': jsonResponse('Meal entry', { $ref: '#/components/schemas/MealLogEntry' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateMeal',
          summary: 'Update a meal log entry',
          description: 'Updates fields of a meal log entry.',
          tags: ['MealLog'],
          parameters: [uuidParam('id', 'Meal log entry ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              meal_date: {
                type: 'string',
                format: 'date',
                description: 'Updated meal date',
                example: '2026-02-22',
              },
              meal_type: {
                type: 'string',
                description: 'Updated meal type',
                example: 'lunch',
              },
              title: {
                type: 'string',
                description: 'Updated meal title',
                example: 'Leftover Chicken Parmesan',
              },
              source: {
                type: 'string',
                description: 'Updated source',
                example: 'leftovers',
              },
              order_ref: {
                type: 'string',
                description: 'Updated order reference',
                example: 'UE-12345',
              },
              restaurant: {
                type: 'string',
                description: 'Updated restaurant name',
                example: 'Luigi\'s Trattoria',
              },
              cuisine: {
                type: 'string',
                description: 'Updated cuisine type',
                example: 'Italian',
              },
              who_cooked: {
                type: 'string',
                description: 'Updated cook name',
                example: 'Sarah',
              },
              notes: {
                type: 'string',
                description: 'Updated notes',
                example: 'Even better the next day',
              },
              image_s3_key: {
                type: 'string',
                description: 'Updated S3 key for meal photo',
                example: 'meals/2026-02-22-lunch.jpg',
              },
              rating: {
                type: 'number',
                description: 'Updated rating',
                example: 4.5,
              },
              leftovers_stored: {
                type: 'boolean',
                description: 'Updated leftover storage status',
                example: false,
              },
              who_ate: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated list of people who ate',
                example: ['Troy'],
              },
              recipe_id: {
                type: 'string',
                format: 'uuid',
                nullable: true,
                description: 'Updated recipe reference (set to null to unlink)',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated meal entry', { $ref: '#/components/schemas/MealLogEntry' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteMeal',
          summary: 'Delete a meal log entry',
          description: 'Deletes a meal log entry.',
          tags: ['MealLog'],
          parameters: [uuidParam('id', 'Meal log entry ID')],
          responses: {
            '204': { description: 'Meal entry deleted' },
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
