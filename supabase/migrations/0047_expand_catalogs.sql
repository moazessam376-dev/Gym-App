-- 0047_expand_catalogs.sql
-- Slice E (pre-pilot UX program): bulk additive expansion of the GLOBAL exercise
-- and food catalogs. Pure INSERTs of platform rows (coach_id NULL) — no schema
-- change, no RLS change. The 0010 policies already gate both tables, and their
-- SELECT policies expose `coach_id IS NULL` globals to every authenticated user
-- (clients log food, coaches build plans), so these rows surface to everyone.
--
-- Idempotent: fixed UUIDs + ON CONFLICT (id) DO NOTHING, so re-applying (the RLS
-- harness applies every migration from scratch) is a no-op on conflict.
--
-- Macros are integer per-100g (CLAUDE.md money/units discipline mirrors here:
-- food_library stores integer grams/kcal, never floats). Egyptian staples are
-- included so pilot athletes can log real local food. KNOWN PILOT LIMITATION:
-- names stay English (Arabic UI, English catalog) — `name_ar` is post-pilot.

-- ── Exercises (globals) ──────────────────────────────────────────────────────
-- muscle_group ∈ {push, pull, legs, upper, lower, core} (enum from 0010).
insert into public.exercise_library (id, coach_id, name, muscle_group, primary_muscle) values
  -- push
  ('e1000000-0000-0000-0000-000000000001', null, 'Machine Chest Press',          'push',  'chest'),
  ('e1000000-0000-0000-0000-000000000002', null, 'Pec Deck Fly',                 'push',  'chest'),
  ('e1000000-0000-0000-0000-000000000003', null, 'Cable Crossover',              'push',  'chest'),
  ('e1000000-0000-0000-0000-000000000004', null, 'Decline Barbell Bench Press',  'push',  'lower chest'),
  ('e1000000-0000-0000-0000-000000000005', null, 'Smith Machine Bench Press',    'push',  'chest'),
  ('e1000000-0000-0000-0000-000000000006', null, 'Landmine Press',               'push',  'shoulders'),
  ('e1000000-0000-0000-0000-000000000007', null, 'Seated Dumbbell Shoulder Press','push', 'shoulders'),
  ('e1000000-0000-0000-0000-000000000008', null, 'Machine Shoulder Press',       'push',  'shoulders'),
  ('e1000000-0000-0000-0000-000000000009', null, 'Cable Lateral Raise',          'push',  'side delts'),
  ('e1000000-0000-0000-0000-00000000000a', null, 'Front Raise',                  'push',  'front delts'),
  ('e1000000-0000-0000-0000-00000000000b', null, 'Close-Grip Bench Press',       'push',  'triceps'),
  ('e1000000-0000-0000-0000-00000000000c', null, 'Skull Crusher',                'push',  'triceps'),
  ('e1000000-0000-0000-0000-00000000000d', null, 'Rope Triceps Pushdown',        'push',  'triceps'),
  ('e1000000-0000-0000-0000-00000000000e', null, 'Dumbbell Triceps Kickback',    'push',  'triceps'),
  ('e1000000-0000-0000-0000-00000000000f', null, 'Push Press',                   'push',  'shoulders'),
  -- pull
  ('e1000000-0000-0000-0000-000000000010', null, 'T-Bar Row',                    'pull',  'back'),
  ('e1000000-0000-0000-0000-000000000011', null, 'Chest-Supported Row',          'pull',  'back'),
  ('e1000000-0000-0000-0000-000000000012', null, 'Single-Arm Dumbbell Row',      'pull',  'lats'),
  ('e1000000-0000-0000-0000-000000000013', null, 'Wide-Grip Lat Pulldown',       'pull',  'lats'),
  ('e1000000-0000-0000-0000-000000000014', null, 'Straight-Arm Pulldown',        'pull',  'lats'),
  ('e1000000-0000-0000-0000-000000000015', null, 'Machine Row',                  'pull',  'back'),
  ('e1000000-0000-0000-0000-000000000016', null, 'Inverted Row',                 'pull',  'back'),
  ('e1000000-0000-0000-0000-000000000017', null, 'Barbell Shrug',                'pull',  'traps'),
  ('e1000000-0000-0000-0000-000000000018', null, 'Reverse Pec Deck',             'pull',  'rear delts'),
  ('e1000000-0000-0000-0000-000000000019', null, 'Preacher Curl',                'pull',  'biceps'),
  ('e1000000-0000-0000-0000-00000000001a', null, 'Incline Dumbbell Curl',        'pull',  'biceps'),
  ('e1000000-0000-0000-0000-00000000001b', null, 'Concentration Curl',           'pull',  'biceps'),
  ('e1000000-0000-0000-0000-00000000001c', null, 'Cable Curl',                   'pull',  'biceps'),
  ('e1000000-0000-0000-0000-00000000001d', null, 'Reverse Curl',                 'pull',  'forearms'),
  ('e1000000-0000-0000-0000-00000000001e', null, 'Wrist Curl',                   'pull',  'forearms'),
  -- legs
  ('e1000000-0000-0000-0000-00000000001f', null, 'Hack Squat',                   'legs',  'quads'),
  ('e1000000-0000-0000-0000-000000000020', null, 'Smith Machine Squat',          'legs',  'quads'),
  ('e1000000-0000-0000-0000-000000000021', null, 'Sumo Deadlift',                'legs',  'hamstrings'),
  ('e1000000-0000-0000-0000-000000000022', null, 'Stiff-Leg Deadlift',           'legs',  'hamstrings'),
  ('e1000000-0000-0000-0000-000000000023', null, 'Lying Leg Curl',               'legs',  'hamstrings'),
  ('e1000000-0000-0000-0000-000000000024', null, 'Step-up',                      'legs',  'quads'),
  ('e1000000-0000-0000-0000-000000000025', null, 'Reverse Lunge',                'legs',  'quads'),
  ('e1000000-0000-0000-0000-000000000026', null, 'Cable Glute Kickback',         'legs',  'glutes'),
  ('e1000000-0000-0000-0000-000000000027', null, 'Hip Abduction Machine',        'legs',  'glutes'),
  ('e1000000-0000-0000-0000-000000000028', null, 'Hip Adduction Machine',        'legs',  'adductors'),
  ('e1000000-0000-0000-0000-000000000029', null, 'Seated Calf Raise',            'legs',  'calves'),
  ('e1000000-0000-0000-0000-00000000002a', null, 'Good Morning',                 'legs',  'hamstrings'),
  ('e1000000-0000-0000-0000-00000000002b', null, 'Box Squat',                    'legs',  'quads'),
  -- upper
  ('e1000000-0000-0000-0000-00000000002c', null, 'Weighted Dip',                 'upper', 'chest'),
  ('e1000000-0000-0000-0000-00000000002d', null, 'Pendlay Row',                  'upper', 'back'),
  ('e1000000-0000-0000-0000-00000000002e', null, 'Neutral-Grip Pull-up',         'upper', 'lats'),
  ('e1000000-0000-0000-0000-00000000002f', null, 'Z Press',                      'upper', 'shoulders'),
  -- lower
  ('e1000000-0000-0000-0000-000000000030', null, 'Sumo Squat',                   'lower', 'quads'),
  ('e1000000-0000-0000-0000-000000000031', null, 'Single-Leg Romanian Deadlift', 'lower', 'hamstrings'),
  ('e1000000-0000-0000-0000-000000000032', null, 'Cable Pull-Through',           'lower', 'glutes'),
  -- core
  ('e1000000-0000-0000-0000-000000000033', null, 'Cable Woodchopper',            'core',  'obliques'),
  ('e1000000-0000-0000-0000-000000000034', null, 'Decline Sit-up',               'core',  'abs'),
  ('e1000000-0000-0000-0000-000000000035', null, 'Dead Bug',                     'core',  'abs'),
  ('e1000000-0000-0000-0000-000000000036', null, 'Mountain Climber',             'core',  'abs'),
  ('e1000000-0000-0000-0000-000000000037', null, 'Side Plank',                   'core',  'obliques'),
  ('e1000000-0000-0000-0000-000000000038', null, 'Pallof Press',                 'core',  'abs'),
  ('e1000000-0000-0000-0000-000000000039', null, 'Bicycle Crunch',               'core',  'abs'),
  ('e1000000-0000-0000-0000-00000000003a', null, 'Toes-to-Bar',                  'core',  'abs'),
  -- olympic / full-body
  ('e1000000-0000-0000-0000-00000000003b', null, 'Power Clean',                  'pull',  'full body'),
  ('e1000000-0000-0000-0000-00000000003c', null, 'Clean and Jerk',               'legs',  'full body'),
  ('e1000000-0000-0000-0000-00000000003d', null, 'Snatch',                       'pull',  'full body'),
  ('e1000000-0000-0000-0000-00000000003e', null, 'Hang Clean',                   'pull',  'full body')
on conflict (id) do nothing;

-- ── Foods (globals) ──────────────────────────────────────────────────────────
-- category ∈ {protein, carbs, fats, vegetables, fruit, dairy, other} (enum 0020).
-- Macros are integer per-100g (cooked unless noted).
insert into public.food_library
  (id, coach_id, name, category, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g) values
  -- Egyptian staples
  ('f1000000-0000-0000-0000-000000000001', null, 'Koshari',                      'carbs',      150,  5, 28,  2),
  ('f1000000-0000-0000-0000-000000000002', null, 'Ful Medames',                  'protein',    110,  8, 16,  1),
  ('f1000000-0000-0000-0000-000000000003', null, 'Taameya (Egyptian Falafel)',   'protein',    330, 13, 31, 17),
  ('f1000000-0000-0000-0000-000000000004', null, 'Aish Baladi (Egyptian Bread)', 'carbs',      250,  9, 49,  2),
  ('f1000000-0000-0000-0000-000000000005', null, 'Molokhia (cooked)',            'vegetables',  60,  4,  6,  2),
  ('f1000000-0000-0000-0000-000000000006', null, 'Mahshi (Stuffed Vine Leaves)', 'carbs',      180,  3, 25,  8),
  ('f1000000-0000-0000-0000-000000000007', null, 'Roz Meammar',                  'carbs',      180,  4, 25,  7),
  ('f1000000-0000-0000-0000-000000000008', null, 'Hawawshi',                     'protein',    250, 14, 24, 11),
  ('f1000000-0000-0000-0000-000000000009', null, 'Bamia (Okra Stew)',            'vegetables',  80,  4,  9,  3),
  ('f1000000-0000-0000-0000-00000000000a', null, 'Feteer Meshaltet',             'carbs',      380,  8, 44, 18),
  ('f1000000-0000-0000-0000-00000000000b', null, 'Eggah (Egyptian Omelette)',    'protein',    150, 10,  3, 11),
  ('f1000000-0000-0000-0000-00000000000c', null, 'Roumy Cheese',                 'dairy',      350, 25,  2, 27),
  ('f1000000-0000-0000-0000-00000000000d', null, 'Domiati Cheese',               'dairy',      250, 14,  3, 20),
  ('f1000000-0000-0000-0000-00000000000e', null, 'Konafa',                       'carbs',      350,  6, 50, 14),
  ('f1000000-0000-0000-0000-00000000000f', null, 'Basbousa',                     'carbs',      340,  5, 52, 13),
  ('f1000000-0000-0000-0000-000000000010', null, 'Om Ali',                       'carbs',      230,  5, 30, 10),
  ('f1000000-0000-0000-0000-000000000011', null, 'Tahini (Sesame Paste)',        'fats',       595, 17, 21, 54),
  ('f1000000-0000-0000-0000-000000000012', null, 'Halawa (Halva)',               'fats',       530, 12, 50, 32),
  ('f1000000-0000-0000-0000-000000000013', null, 'Baba Ganoush',                 'vegetables', 120,  3,  9,  9),
  ('f1000000-0000-0000-0000-000000000014', null, 'Shakshuka',                    'protein',    110,  6,  7,  6),
  -- proteins
  ('f1000000-0000-0000-0000-000000000015', null, 'Tuna (canned in water)',       'protein',    116, 26,  0,  1),
  ('f1000000-0000-0000-0000-000000000016', null, 'Tilapia (cooked)',             'protein',    128, 26,  0,  3),
  ('f1000000-0000-0000-0000-000000000017', null, 'Cod (cooked)',                 'protein',    105, 23,  0,  1),
  ('f1000000-0000-0000-0000-000000000018', null, 'Shrimp (cooked)',              'protein',     99, 24,  0,  1),
  ('f1000000-0000-0000-0000-000000000019', null, 'Turkey Breast (cooked)',       'protein',    135, 30,  0,  1),
  ('f1000000-0000-0000-0000-00000000001a', null, 'Beef Steak (cooked, lean)',    'protein',    217, 26,  0, 12),
  ('f1000000-0000-0000-0000-00000000001b', null, 'Lamb (cooked)',                'protein',    294, 25,  0, 21),
  ('f1000000-0000-0000-0000-00000000001c', null, 'Whey Protein Powder',          'protein',    400, 80,  8,  6),
  ('f1000000-0000-0000-0000-00000000001d', null, 'Cottage Cheese (low-fat)',     'dairy',       72, 12,  3,  1),
  ('f1000000-0000-0000-0000-00000000001e', null, 'Tofu (firm)',                  'protein',    144, 15,  4,  9),
  ('f1000000-0000-0000-0000-00000000001f', null, 'Sardines (canned in oil)',     'protein',    208, 25,  0, 11),
  -- carbs / legumes
  ('f1000000-0000-0000-0000-000000000020', null, 'Whole Wheat Bread',            'carbs',      247, 13, 41,  3),
  ('f1000000-0000-0000-0000-000000000021', null, 'White Bread',                  'carbs',      265,  9, 49,  3),
  ('f1000000-0000-0000-0000-000000000022', null, 'Pita Bread',                   'carbs',      275,  9, 55,  1),
  ('f1000000-0000-0000-0000-000000000023', null, 'Pasta (cooked)',               'carbs',      158,  6, 31,  1),
  ('f1000000-0000-0000-0000-000000000024', null, 'Whole Wheat Pasta (cooked)',   'carbs',      124,  5, 27,  1),
  ('f1000000-0000-0000-0000-000000000025', null, 'Quinoa (cooked)',              'carbs',      120,  4, 21,  2),
  ('f1000000-0000-0000-0000-000000000026', null, 'Couscous (cooked)',            'carbs',      112,  4, 23,  0),
  ('f1000000-0000-0000-0000-000000000027', null, 'Bulgur (cooked)',              'carbs',       83,  3, 19,  0),
  ('f1000000-0000-0000-0000-000000000028', null, 'Lentils (cooked)',             'protein',    116,  9, 20,  0),
  ('f1000000-0000-0000-0000-000000000029', null, 'Chickpeas (cooked)',           'protein',    164,  9, 27,  3),
  ('f1000000-0000-0000-0000-00000000002a', null, 'Kidney Beans (cooked)',        'protein',    127,  9, 23,  1),
  ('f1000000-0000-0000-0000-00000000002b', null, 'Fava Beans (cooked)',          'protein',    110,  8, 20,  0),
  ('f1000000-0000-0000-0000-00000000002c', null, 'Cornflakes',                   'carbs',      357,  8, 84,  1),
  -- fruit
  ('f1000000-0000-0000-0000-00000000002d', null, 'Orange',                       'fruit',       47,  1, 12,  0),
  ('f1000000-0000-0000-0000-00000000002e', null, 'Grapes',                       'fruit',       69,  1, 18,  0),
  ('f1000000-0000-0000-0000-00000000002f', null, 'Strawberries',                 'fruit',       32,  1,  8,  0),
  ('f1000000-0000-0000-0000-000000000030', null, 'Watermelon',                   'fruit',       30,  1,  8,  0),
  ('f1000000-0000-0000-0000-000000000031', null, 'Mango',                        'fruit',       60,  1, 15,  0),
  ('f1000000-0000-0000-0000-000000000032', null, 'Dates (Medjool)',              'fruit',      277,  2, 75,  0),
  ('f1000000-0000-0000-0000-000000000033', null, 'Guava',                        'fruit',       68,  3, 14,  1),
  ('f1000000-0000-0000-0000-000000000034', null, 'Pineapple',                    'fruit',       50,  1, 13,  0),
  ('f1000000-0000-0000-0000-000000000035', null, 'Pomegranate',                  'fruit',       83,  2, 19,  1),
  -- vegetables
  ('f1000000-0000-0000-0000-000000000036', null, 'Spinach',                      'vegetables',  23,  3,  4,  0),
  ('f1000000-0000-0000-0000-000000000037', null, 'Carrots',                      'vegetables',  41,  1, 10,  0),
  ('f1000000-0000-0000-0000-000000000038', null, 'Cucumber',                     'vegetables',  15,  1,  4,  0),
  ('f1000000-0000-0000-0000-000000000039', null, 'Tomato',                       'vegetables',  18,  1,  4,  0),
  ('f1000000-0000-0000-0000-00000000003a', null, 'Bell Pepper',                  'vegetables',  31,  1,  6,  0),
  ('f1000000-0000-0000-0000-00000000003b', null, 'Onion',                        'vegetables',  40,  1,  9,  0),
  ('f1000000-0000-0000-0000-00000000003c', null, 'Green Beans',                  'vegetables',  31,  2,  7,  0),
  ('f1000000-0000-0000-0000-00000000003d', null, 'Cauliflower',                  'vegetables',  25,  2,  5,  0),
  ('f1000000-0000-0000-0000-00000000003e', null, 'Zucchini',                     'vegetables',  17,  1,  3,  0),
  ('f1000000-0000-0000-0000-00000000003f', null, 'Mushrooms',                    'vegetables',  22,  3,  3,  0),
  ('f1000000-0000-0000-0000-000000000040', null, 'Eggplant',                     'vegetables',  25,  1,  6,  0),
  -- fats / dairy / other
  ('f1000000-0000-0000-0000-000000000041', null, 'Peanut Butter',                'fats',       588, 25, 20, 50),
  ('f1000000-0000-0000-0000-000000000042', null, 'Walnuts',                      'fats',       654, 15, 14, 65),
  ('f1000000-0000-0000-0000-000000000043', null, 'Cashews',                      'fats',       553, 18, 30, 44),
  ('f1000000-0000-0000-0000-000000000044', null, 'Olive Oil',                    'fats',       884,  0,  0,100),
  ('f1000000-0000-0000-0000-000000000045', null, 'Butter',                       'fats',       717,  1,  0, 81),
  ('f1000000-0000-0000-0000-000000000046', null, 'Avocado',                      'fats',       160,  2,  9, 15),
  ('f1000000-0000-0000-0000-000000000047', null, 'Cheddar Cheese',               'dairy',      403, 25,  1, 33),
  ('f1000000-0000-0000-0000-000000000048', null, 'Mozzarella',                   'dairy',      280, 28,  3, 17),
  ('f1000000-0000-0000-0000-000000000049', null, 'Feta Cheese',                  'dairy',      264, 14,  4, 21),
  ('f1000000-0000-0000-0000-00000000004a', null, 'Honey',                        'other',      304,  0, 82,  0),
  ('f1000000-0000-0000-0000-00000000004b', null, 'Dark Chocolate (70%)',         'other',      598,  8, 46, 43)
on conflict (id) do nothing;
