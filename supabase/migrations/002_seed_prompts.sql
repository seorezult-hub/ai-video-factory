-- Seed: Cosmetics prompt library (Level 1-2)
-- Source: research-ai-video-report.md

insert into prompts (category, level, prompt_text, scene_type, camera_move, mood) values

-- Level 1: Basic cosmetics
('cosmetics', 1,
 'Skincare serum bottle surrounded by fresh flowers, slow orbit around the product, natural light, pastel color palette, clean beauty aesthetic.',
 'product_shot', 'slow orbit', 'Soft & Natural'),

('cosmetics', 1,
 'Luxury perfume bottle on a white marble surface, golden liquid inside, slow dolly push-in, soft studio lighting from the left, clean minimal aesthetic, avoid camera shake.',
 'product_shot', 'slow push-in', 'Luxury'),

('cosmetics', 1,
 'Young woman in white linen dress sitting by a window, warm natural daylight from the right, slight smile, static camera, contemporary commercial look, soft and bright.',
 'lifestyle', 'static', 'Soft & Natural'),

-- Level 2: Commercial with @image references
('cosmetics', 2,
 '@image1 as the model. She applies moisturizer to her face, looking into camera with a subtle smile. Soft studio lighting with warm backlight. Rack focus from hands to face. Contemporary beauty commercial, clean white background. Avoid identity drift, avoid bent fingers.',
 'model_application', 'rack focus', 'Luxury'),

('cosmetics', 2,
 'UGC-style vertical 9:16 video. @image1 as the creator. She holds the serum bottle to camera, smiles, applies it to cheek, and shows visible skin improvement. Natural bedroom lighting, handheld slight camera shake, conversational and relatable.',
 'ugc_style', 'handheld', 'Playful'),

('cosmetics', 2,
 '@image1 as model reference. She walks through a field of flowers in slow motion, wind in hair, wearing the brand''s summer collection. Wide shot transitioning to medium close-up. Soft golden diffused light, dreamy and ethereal mood.',
 'lifestyle', 'tracking shot', 'Soft & Natural'),

-- Fashion prompts
('fashion', 1,
 'White sneakers on a clean concrete floor, gentle pan left to right, soft diffused light, no shadows, product photography aesthetic, sharp and minimal.',
 'product_shot', 'pan', 'Minimalist'),

('fashion', 2,
 'Fashion lookbook featuring model from @image1. She walks slowly toward camera on a rooftop at golden hour, wearing the dress from @image2. Tracking shot, slight zoom in, anamorphic lens quality, warm cinematic tones. Avoid jitter.',
 'lookbook', 'tracking shot', 'Luxury'),

-- Food prompts
('food', 1,
 'A ceramic cup of espresso on a wooden table, steam rising slowly, overhead static shot, warm morning light, cozy café atmosphere, close-up, 9:16 vertical format.',
 'product_shot', 'static', 'Soft & Natural'),

('food', 2,
 'Overhead shot of @image1 (food product) placed on a rustic wooden table. Steam rising gently. Camera slow zoom out to reveal full table setting. Warm natural light from a side window, VSCO filter, lifestyle food photography aesthetic.',
 'overhead', 'dolly back', 'Soft & Natural'),

-- Tech prompts
('tech', 2,
 'Scene 1: Close-up of @image1 (smartphone) on a glass table, glowing screen. Camera slow push-in. Scene 2: Hands pick it up, thumb swipes across screen, satisfaction visible. Studio lighting, tech commercial aesthetic, sharp and clean.',
 'product_demo', 'slow push-in', 'Minimalist'),

-- Real estate
('real_estate', 2,
 'Cinematic walk-through of a luxury penthouse interior. Slow dolly forward through the living room revealing floor-to-ceiling windows with city view. @image1 as reference for interior style. Golden hour light flooding in, architectural photography quality.',
 'walkthrough', 'slow push-in', 'Luxury'),

-- Music video
('music', 3,
 '@image1 as the singer. She stands alone in an empty neon-lit alley at night, rain falling. Camera starts wide and slowly pushes in. Sync to @audio1 beat drops. Moody cinematic grade, 9:16 vertical, blue and purple tones. Avoid identity drift.',
 'atmosphere', 'slow push-in', 'Bold');
