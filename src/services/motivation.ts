import AsyncStorage from '@react-native-async-storage/async-storage';

export const MOTIVATIONS = ['energy', 'health', 'feel', 'strength'] as const;
export type Motivation = typeof MOTIVATIONS[number];
export const OBSTACLES = ['time', 'ideas', 'out', 'stop'] as const;
export type Obstacle = typeof OBSTACLES[number];

export const MOTIVATION_KEY = '@kandro/motivation:v1';
export type MotivationAnswers = { motivation: Motivation | null; obstacle: Obstacle | null };

/**
 * Why someone started and what usually stops them. Device-local only, never
 * synced: it only decides what the tour and first week lead with.
 */
export async function saveMotivation(answers: MotivationAnswers) {
  await AsyncStorage.setItem(MOTIVATION_KEY, JSON.stringify(answers)).catch(() => undefined);
}
export function parseMotivation(raw: string | null): MotivationAnswers {
  try {
    const value = JSON.parse(raw ?? '{}') as Partial<MotivationAnswers>;
    return {
      motivation: MOTIVATIONS.includes(value.motivation as Motivation) ? value.motivation as Motivation : null,
      obstacle: OBSTACLES.includes(value.obstacle as Obstacle) ? value.obstacle as Obstacle : null,
    };
  } catch { return { motivation: null, obstacle: null }; }
}
export async function loadMotivation() {
  return parseMotivation(await AsyncStorage.getItem(MOTIVATION_KEY).catch(() => null));
}
