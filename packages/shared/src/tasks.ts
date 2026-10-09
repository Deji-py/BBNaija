/** Built-in Big Brother tasks (M6). Definitions shared by server (rules) and clients (UI). */

export type TaskType = "cooking" | "treasure" | "quiz";

export const REWARDS = {
  immunity: { label: "Immunity", icon: "🛡️" },
  nominationPower: { label: "Extra nomination power", icon: "⭐" },
  crown: { label: "Golden crown", icon: "👑" },
} as const;
export type RewardId = keyof typeof REWARDS;
export const REWARD_IDS = Object.keys(REWARDS) as RewardId[];

export interface TaskDefinition {
  type: TaskType;
  title: string;
  description: string;
  /** How long the task runs (s). The quiz runs per question instead. */
  durationSec: number;
}

export const TASKS: Record<TaskType, TaskDefinition> = {
  cooking: {
    type: "cooking",
    title: "Cooking challenge",
    description: "Grab ingredients from the fridge, prep them at the counter, then cook at the stove. Most dishes wins!",
    durationSec: 180,
  },
  treasure: {
    type: "treasure",
    title: "Treasure hunt",
    description: "Gems are hidden around the house. Find them and press E to pick them up. Most gems wins!",
    durationSec: 180,
  },
  quiz: {
    type: "quiz",
    title: "House quiz",
    description: "Answer each question before the timer runs out. Most correct answers wins!",
    durationSec: 0,
  },
};

// --- cooking ---
/** Per-player progress through one dish: 0 → fridge → 1 → counter → 2 → stove. */
export const COOK_STAGE = { start: 0, hasIngredients: 1, prepped: 2 } as const;
/** Seconds of cooking at the stove (after prepping) to finish a dish. */
export const COOK_SECONDS = 4;

// --- treasure hunt ---
export const GEM_COUNT = 6;
/** How close (m) you must be to pick up a gem. */
export const GEM_PICKUP_RANGE = 1.2;
/** Hiding spots; each hunt picks GEM_COUNT of them at random. All reachable within GEM_PICKUP_RANGE. */
export const GEM_SPOTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 8.1, z: 2.3 }, // behind the sofa
  { x: -4.3, z: 9.3 }, // lounge corner
  { x: 14.3, z: 9.3 }, // lounge corner by the garden
  { x: 1.7, z: -9.3 }, // kitchen corner
  { x: 8, z: -5.2 }, // under the dining table
  { x: 14.3, z: -2.7 }, // kitchen corner
  { x: -11.7, z: -8.5 }, // between two beds
  { x: -14.3, z: -2.7 }, // bedroom corner
  { x: -14.3, z: 0.2 }, // gym corner
  { x: -6, z: 9.3 }, // gym corner
  { x: -12.5, z: 8.4 }, // between bench and weights
  { x: -4.3, z: -9.3 }, // diary room corner
  { x: 11.5, z: 24.5 }, // under a garden tree
  { x: -14.3, z: 25.3 }, // garden corner
  { x: 2.6, z: 21.6 }, // by the pool's corner
  { x: 9.5, z: 17.6 }, // behind the loungers
];

// --- quiz ---
export const QUIZ_QUESTIONS_PER_ROUND = 5;
export const QUIZ_ANSWER_SECONDS = 15;
export const QUIZ_REVEAL_SECONDS = 4;

export interface QuizQuestion {
  question: string;
  options: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
}

export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  { question: "How many areas does the house have, counting the garden?", options: ["4", "5", "6", "7"], correct: 2 },
  { question: "Which room has the famous red chair?", options: ["Kitchen", "Diary Room", "Gym", "Bedroom"], correct: 1 },
  { question: "What is the capital of Nigeria?", options: ["Lagos", "Abuja", "Kano", "Ibadan"], correct: 1 },
  { question: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], correct: 1 },
  { question: "Which planet is known as the Red Planet?", options: ["Venus", "Jupiter", "Mars", "Saturn"], correct: 2 },
  { question: "Which key do you press to use things in the house?", options: ["Q", "E", "F", "Space"], correct: 1 },
  {
    question: "Which dish do Nigeria and Ghana famously argue about?",
    options: ["Jollof rice", "Egusi soup", "Suya", "Fufu"],
    correct: 0,
  },
  { question: "How many minutes are in 2 hours?", options: ["100", "120", "140", "160"], correct: 1 },
  { question: "Which ocean lies off the coast of Lagos?", options: ["Indian", "Pacific", "Atlantic", "Arctic"], correct: 2 },
  { question: "What colour do you get by mixing blue and yellow?", options: ["Green", "Purple", "Orange", "Brown"], correct: 0 },
  { question: "How many players does a football team have on the pitch?", options: ["9", "10", "11", "12"], correct: 2 },
  {
    question: "Where do housemates talk privately with Big Brother?",
    options: ["Garden", "Diary Room", "Gym", "Kitchen"],
    correct: 1,
  },
];
