export type NicheKey =
  | "cosmetics"
  | "fashion"
  | "luxury"
  | "food"
  | "fitness"
  | "tech"
  | "real_estate"
  | "supplements"
  | "music";

export type ColorGrade =
  | "Люкс"
  | "Яркость"
  | "Дерзко"
  | "Энергия"
  | "Нежность"
  | "Природа";

export type TransitionStyle = "dissolve" | "horzopen" | "slideup" | "fade";
export type MusicTempo = "slow" | "medium" | "fast";

export interface NicheScene {
  sceneType: "nature" | "product" | "face" | "action" | "logo";
  label: string;
  visualPrompt: string;
  cameraMovement: string;
}

export interface NicheTemplate {
  niche: NicheKey;
  displayName: string;
  storyArc: NicheScene[];
  visualKeywords: string[];
  colorGrade: ColorGrade;
  transitionStyle: TransitionStyle;
  musicTempo: MusicTempo;
  imageSlotsUsage: Record<string, string>;
  cameraMovements: string[];
  promptAntiPatterns: string[];
}

const NICHE_TEMPLATES: Record<NicheKey, NicheTemplate> = {
  cosmetics: {
    niche: "cosmetics",
    displayName: "Косметика / Skincare / Makeup",
    colorGrade: "Нежность",
    transitionStyle: "dissolve",
    musicTempo: "slow",
    visualKeywords: [
      "dewy skin texture", "glass skin", "serum droplet", "soft diffused light",
      "cream swirl", "rose gold accents", "pearl finish", "clean beauty aesthetic",
      "botanical ingredient", "dropper bottle", "facial oil shimmer",
    ],
    cameraMovements: ["slow push-in", "rack focus", "static", "overhead"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "blood", "gore", "injection", "needle", "surgery", "wound",
      "naked skin" /* use "bare skin" instead */, "sexy", "seductive",
      "before/after" /* implies medical claim */,
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Ingredient world",
        visualPrompt: "A single white rose petal falls in slow motion into clear water, ripples expand across the surface. Overhead static shot, shallow depth of field, water fills the frame. Cool ivory and soft blush tones, botanical beauty editorial aesthetic.",
        cameraMovement: "overhead",
      },
      {
        sceneType: "product",
        label: "Product reveal",
        visualPrompt: "@Image2 stands on white marble, a single serum droplet falls from the dropper in macro slow motion. Slow push-in toward the label. Warm diffused side light from left, cream and pearl tones, glass skin editorial aesthetic.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "face",
        label: "Skin ritual",
        visualPrompt: "@Image1 gently presses fingertips to cheek, eyes closed, slow patting motion. Rack focus from fingertips to face. Soft diffused window light from upper left, warm ivory skin tones, dewy skin texture. Clean beauty commercial aesthetic. @Image2 visible softly out of focus in background.",
        cameraMovement: "rack focus",
      },
      {
        sceneType: "product",
        label: "Texture close-up",
        visualPrompt: "@Image3 product texture detail — rich cream swirl on a white ceramic spoon, center frame. Static overhead camera, texture fills the shot. Soft diffused top light, pearl highlight on the swirl, botanical green leaf accent on the side. Luxury skincare editorial, clean white negative space.",
        cameraMovement: "static",
      },
      {
        sceneType: "logo",
        label: "Brand close",
        visualPrompt: "@Image4 brand logo engraved on white marble surface. Warm ambient light sweeps slowly from left to right, illuminating logo letters with a soft glow. Static camera, minimal luxury aesthetic, ivory and warm gold tones. @Image2 product rests at the edge of frame.",
        cameraMovement: "static",
      },
    ],
  },

  fashion: {
    niche: "fashion",
    displayName: "Одежда / Аксессуары / Обувь",
    colorGrade: "Дерзко",
    transitionStyle: "horzopen",
    musicTempo: "medium",
    visualKeywords: [
      "fabric in motion", "architectural silhouette", "editorial gaze", "stark contrast",
      "construction detail", "seam texture", "monochrome palette", "structural drape",
      "runway framing", "razor sharp shadow", "urban backdrop",
    ],
    cameraMovements: ["tracking shot", "slow orbit", "static", "dolly back"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "underwear model", "lingerie pose", "revealing clothes", "sexy pose",
      "nude", "skin-tight" /* use "form-fitting" */, "provocative",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Architecture hook",
        visualPrompt: "Empty brutalist concrete staircase, harsh directional light casts geometric shadows across the steps. Static wide shot, no people. Cool blue-grey tones, deep blacks, razor-sharp contrast. Editorial fashion aesthetic.",
        cameraMovement: "static",
      },
      {
        sceneType: "face",
        label: "Silhouette entry",
        visualPrompt: "@Image1 walks through the brutalist space, wearing @Image2 garment, from background to foreground. Tracking shot from the side, medium distance. Fabric moves with each stride, construction detail visible in harsh directional light. Cool grey tones, architecture blurred, @Image1 sharp.",
        cameraMovement: "tracking shot",
      },
      {
        sceneType: "product",
        label: "Fabric orbit",
        visualPrompt: "@Image2 garment fabric fills the frame as camera orbits slowly 180°. Ultra-close on material surface, seams and weave sharp. Directional light from upper right, fabric as sculpture. Slow orbit, editorial light. @Image3 detail visible as camera completes the arc.",
        cameraMovement: "slow orbit",
      },
      {
        sceneType: "face",
        label: "Direct gaze",
        visualPrompt: "@Image1 turns to face camera directly and holds gaze. Medium close-up, static shot, face sharp against blurred concrete background. Harsh directional side light from left, deep shadow on half the face. Editorial confidence, no smile. @Image5 accessory visible at the shoulder — bag strap or jewellery.",
        cameraMovement: "static",
      },
      {
        sceneType: "logo",
        label: "Brand mark",
        visualPrompt: "@Image4 brand logo on a swing tag or sewn label, held in extreme close-up. Slow dolly back reveals the full look — @Image1 wearing @Image2 garment against white seamless. Studio strobe light from above, pure white and black. @Image4 logo visible as camera pulls to full-body frame.",
        cameraMovement: "dolly back",
      },
    ],
  },

  luxury: {
    niche: "luxury",
    displayName: "Парфюм / Ювелирка / Часы / Премиум",
    colorGrade: "Люкс",
    transitionStyle: "dissolve",
    musicTempo: "slow",
    visualKeywords: [
      "black cracked marble", "gold leaf", "amber liquid swirl", "crystal facets",
      "deep shadow luxury", "velvet surface", "rose gold reflection", "smoke wisps",
      "diamond scatter", "mechanical precision", "weight and stillness",
    ],
    cameraMovements: ["slow push-in", "slow orbit", "rack focus", "static"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "blood", "death", "violence", "naked", "nude", "sexy",
      "drug", "weapon", "gore", "explicit", "cheap", "discount",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "World hook",
        visualPrompt: "Vast Saharan dune at magic hour, amber light cuts across ridges creating deep shadow valleys. Static overhead camera tilts slowly to reveal the endless horizon. Deep gold and shadow black tones, heat haze on the horizon. Luxury scale, absolute stillness.",
        cameraMovement: "static",
      },
      {
        sceneType: "face",
        label: "Protagonist arrives",
        visualPrompt: "@Image1 stands at the edge of desert cliffs, back to camera, facing the horizon. Slow push-in toward the figure. Ivory fabric catches the desert wind. Warm amber rim light from left, deep shadow on the right side. Gold and shadow black palette, camera breathes slowly toward @Image1.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "product",
        label: "Product ritual",
        visualPrompt: "@Image1 hand lifts @Image2 perfume bottle from black cracked marble in slow motion. Slow orbit circles the bottle 90°, label facing camera. Amber liquid visible through the glass, warm side rim light catches crystal facets. Gold and deep black tones, smoke wisps rise behind. Luxury perfume commercial aesthetic.",
        cameraMovement: "slow orbit",
      },
      {
        sceneType: "product",
        label: "Detail cascade",
        visualPrompt: "@Image3 in extreme close-up — watch crown, bottle stopper, or diamond facet fills the frame. Rack focus travels from surface texture to the reflection in the material. Static macro shot, warm gold side light, single catchlight. @Image2 visible softly bokeh'd in the background.",
        cameraMovement: "rack focus",
      },
      {
        sceneType: "logo",
        label: "Brand close",
        visualPrompt: "@Image4 brand logo in gold on black velvet surface. Ultra-slow push-in stops just before the logo fills the frame. Single warm overhead spotlight, every letterform lit. @Image2 product rests beside the logo. Deep black surround, complete stillness. Luxury brand reveal.",
        cameraMovement: "slow push-in",
      },
    ],
  },

  food: {
    niche: "food",
    displayName: "Еда / Напитки / Рестораны",
    colorGrade: "Яркость",
    transitionStyle: "dissolve",
    musicTempo: "medium",
    visualKeywords: [
      "condensation on glass", "steam rising", "caramel drizzle", "macro texture",
      "herb garnish", "golden crust", "coffee crema", "chocolate melt",
      "sauce pour", "bread pull", "colour saturation", "fresh and tactile",
    ],
    cameraMovements: ["overhead", "slow push-in", "rack focus", "static"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "raw meat close-up", "bloody steak" /* use "medium rare" */, "mouldy",
      "insects", "extreme gore", "unappetising", "dirty",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Texture hook",
        visualPrompt: "A single droplet of honey falls in slow motion onto a dark wood surface, spreading into golden threads. Overhead macro shot, warm amber light from directly above, honey fills the frame. Rich gold and walnut brown tones, fully saturated. Food editorial aesthetic.",
        cameraMovement: "overhead",
      },
      {
        sceneType: "action",
        label: "Transformation moment",
        visualPrompt: "@Image2 being plated — sauce cascades from above, steam rises from the surface. Static overhead camera, @Image1 hands visible at the edges guiding the pour. Slow motion, every droplet sharp. Saturated natural colours, warm kitchen light from upper right. Condensation and gleam on sauce.",
        cameraMovement: "static",
      },
      {
        sceneType: "face",
        label: "Human pleasure",
        visualPrompt: "@Image1 in profile, eyes closing as they savour the first sip or bite. Rack focus from @Image5 branded cup or plate in hand to their expression. Medium close-up. Warm window light from left, natural skin tones. Authentic, not performed.",
        cameraMovement: "rack focus",
      },
      {
        sceneType: "product",
        label: "Product full frame",
        visualPrompt: "@Image2 hero dish centred on slate surface, perfect plating. Slow push-in reveals the full composition. Dramatic side light from left, surface texture sharp. @Image5 branded vessel visible in frame. Colour fully saturated, premium food photography aesthetic.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "logo",
        label: "Brand lifestyle",
        visualPrompt: "@Image4 brand logo on the restaurant window, sharp. Static shot from outside looking in. Warm amber interior glow behind, cold blue street light on the glass surface. @Image2 product on the table in soft focus. @Image1 figure sitting in the bokeh background. Aspirational lifestyle moment.",
        cameraMovement: "static",
      },
    ],
  },

  fitness: {
    niche: "fitness",
    displayName: "Спорт / Фитнес / Здоровье",
    colorGrade: "Энергия",
    transitionStyle: "slideup",
    musicTempo: "fast",
    visualKeywords: [
      "muscle definition", "sweat droplets", "motion blur", "gym chrome equipment",
      "chalk dust", "compound movement", "explosive action", "stadium light",
      "determination in eyes", "athletic silhouette", "peak effort",
    ],
    cameraMovements: ["tracking shot", "static", "slow orbit", "overhead"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "blood", "injury", "pain", "extreme bodily harm", "steroids" /* use "supplements" */,
      "before/after weight loss" /* medical claim */, "nude", "excessive skin",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Energy hook",
        visualPrompt: "Empty gym at dawn — chrome barbells, chalk-dusted platforms, stadium lights flicker on in sequence. Wide static shot, no people. Cold blue-white light, deep corner shadows. Industrial, clean, purposeful. Anticipation before effort.",
        cameraMovement: "static",
      },
      {
        sceneType: "action",
        label: "Peak effort",
        visualPrompt: "@Image1 at peak of a compound lift or sprint finish, wearing @Image2 activewear. Tracking shot from the side, medium distance. Sweat droplets catch the stadium light, motion blur on surrounding elements, @Image1 sharp. Cold-white stadium light. @Image4 logo visible on clothing.",
        cameraMovement: "tracking shot",
      },
      {
        sceneType: "face",
        label: "Determination",
        visualPrompt: "@Image1 face in extreme close-up — jaw set, eyes locked forward, sweat on brow. Static shot, face fills the frame. Hard directional light from upper left, deep shadow on the right side. Raw focus. @Image4 logo on collar visible at the bottom of frame.",
        cameraMovement: "static",
      },
      {
        sceneType: "product",
        label: "Product in action",
        visualPrompt: "@Image2 activewear or @Image5 product held by @Image1 hands as overhead camera orbits 90°. Fabric texture and technology detail visible throughout the arc. Clean grey studio surface, cold white studio light. @Image4 branding clearly legible in frame.",
        cameraMovement: "slow orbit",
      },
      {
        sceneType: "logo",
        label: "Brand power",
        visualPrompt: "@Image4 brand logo on a dark background, single overhead spotlight illuminating it. @Image1 stands below in silhouette, back straight, head up. Slow push-in stops on the logo. Stadium atmosphere, bold and minimal. @Image1 silhouette and @Image4 logo together in final frame.",
        cameraMovement: "slow push-in",
      },
    ],
  },

  tech: {
    niche: "tech",
    displayName: "Гаджеты / Приложения / Электроника",
    colorGrade: "Дерзко",
    transitionStyle: "slideup",
    musicTempo: "medium",
    visualKeywords: [
      "edge-to-edge screen", "aluminium chassis", "precision milled", "UI glow",
      "cable-free desk", "anodised surface", "port detail", "refractive glass",
      "dark mode interface", "product on white", "negative space",
    ],
    cameraMovements: ["slow push-in", "rack focus", "dolly back", "static"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "broken screen", "cracked", "exploding battery", "hacked", "malware",
      "surveillance camera angle" /* implies privacy violation */, "weapon",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Problem world",
        visualPrompt: "Cluttered desk — tangled cables, scattered devices, notification badges everywhere. Wide static shot from slight overhead angle. Harsh fluorescent light, cold blue-grey tones, visual noise and chaos. Nothing is clean. Three seconds of friction.",
        cameraMovement: "static",
      },
      {
        sceneType: "product",
        label: "Device arrives",
        visualPrompt: "@Image2 placed on a cleared desk surface, everything else gone. Slow push-in from medium to close. Single warm-cool studio light from upper right catches the aluminium edge. Screen illuminates with a clean interface. Negative space dominates, precision and calm replace chaos.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "product",
        label: "Engineering detail",
        visualPrompt: "@Image3 device side profile in extreme macro — precision milled edge, port array, button placement. Rack focus travels from one end to the other along the chassis. Cold studio light from the side. Dark background, anodised surface texture sharp. Every tolerance visible.",
        cameraMovement: "rack focus",
      },
      {
        sceneType: "face",
        label: "Flow state",
        visualPrompt: "@Image1 working with @Image2 in quiet focus, eyes on screen, minimal movement. Slow dolly back reveals the clean workspace. Warm ambient light from window left, everything else dark. Flow state. @Image4 logo visible on the device. @Image5 accessory on the desk.",
        cameraMovement: "dolly back",
      },
      {
        sceneType: "logo",
        label: "Brand minimal",
        visualPrompt: "@Image2 on pure white surface, @Image4 brand logo centred in frame. Static overhead camera, product is the only object. Single diffused overhead light, no shadows. Absolute minimalism — Apple-grade product shot. @Image4 logo perfectly legible throughout.",
        cameraMovement: "static",
      },
    ],
  },

  real_estate: {
    niche: "real_estate",
    displayName: "Недвижимость",
    colorGrade: "Люкс",
    transitionStyle: "dissolve",
    musicTempo: "slow",
    visualKeywords: [
      "golden hour interior", "marble countertop", "floor-to-ceiling glass",
      "city panorama", "architectural volume", "natural stone", "cascading light",
      "negative space living", "blue hour exterior", "crafted handle detail",
    ],
    cameraMovements: ["tracking shot", "slow push-in", "dolly back", "overhead"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "construction workers" /* implies unfinished */, "empty lot",
      "renovation chaos", "cracks", "damage", "neighbour conflict",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Establishing aerial",
        visualPrompt: "Aerial view of the city skyline at golden hour, camera slowly pushes toward one distinctive building silhouette in the centre. Warm amber light sweeps across glass facades, city below in soft bokeh. Overhead tilt downward continues the push-in. Deep gold and shadow navy tones, scale and aspiration.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "product",
        label: "Interior light play",
        visualPrompt: "@Image2 living room interior at midday, a shaft of sunlight enters through floor-to-ceiling windows and slowly tracks across white marble floors. Tracking shot follows the light path from right to left. @Image3 countertop detail catches the light as it passes. Warm golden light, rich natural materials, complete stillness.",
        cameraMovement: "tracking shot",
      },
      {
        sceneType: "face",
        label: "Lifestyle moment",
        visualPrompt: "@Image1 stands at the floor-to-ceiling window, coffee in hand, looking at the city below. Slow dolly back reveals the full room depth. Morning light, warm amber room interior, cold city blue outside the glass. @Image5 terrace or pool visible beyond the window. Ownership implied.",
        cameraMovement: "dolly back",
      },
      {
        sceneType: "product",
        label: "Craftsmanship detail",
        visualPrompt: "@Image3 architectural detail in extreme close-up — door handle, marble edge, or window frame. Rack focus travels from surface texture to material seam to light reflection. Cold precision light from the side. @Image2 room blurred in the background. Craftsmanship visible in every tolerance.",
        cameraMovement: "rack focus",
      },
      {
        sceneType: "logo",
        label: "Blue hour brand",
        visualPrompt: "@Image2 property exterior at blue hour, windows glowing warm amber from within, dark navy sky above. Static wide shot, perfectly composed. @Image4 developer logo on the building facade or entry sign, lit by ambient street light, fully legible. Quiet prestige, no people.",
        cameraMovement: "static",
      },
    ],
  },

  supplements: {
    niche: "supplements",
    displayName: "БАДы / Витамины / Спортпит",
    colorGrade: "Природа",
    transitionStyle: "fade",
    musicTempo: "medium",
    visualKeywords: [
      "botanical extract", "capsule macro", "powder scoop", "green leaf detail",
      "natural ingredient", "laboratory precision", "clean label", "earth tones",
      "glass jar texture", "morning ritual", "holistic wellness",
    ],
    cameraMovements: ["overhead", "slow push-in", "rack focus", "static"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "drug", "pharmaceutical", "injection", "syringe", "pill addiction",
      "before/after transformation" /* medical claim risk */,
      "cure", "treat", "heal" /* avoid medical claims */,
      "steroid", "doping", "banned substance",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Ingredient origin",
        visualPrompt: "@Image5 raw botanical ingredient — root, powder, or berry — on dark natural wood, morning light from a low window catches the organic texture. Overhead static camera, ingredient fills 70% of frame. Earth green and amber tones, natural and clean.",
        cameraMovement: "overhead",
      },
      {
        sceneType: "product",
        label: "Product reveal",
        visualPrompt: "@Image2 supplement jar or pouch on a white birch wood surface, surrounded by @Image5 natural ingredients. Slow push-in toward the product label, @Image4 brand logo comes into focus. Soft diffused window light from upper left, warm amber and natural green tones. Clean label aesthetic, premium wellness photography.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "face",
        label: "Morning ritual",
        visualPrompt: "@Image1 at a wooden kitchen table in morning light, pouring capsules from @Image2 into palm and pausing. Rack focus from capsules in hand to @Image1 calm face. Warm window light, soft earth tones. @Image5 ingredient visible nearby. Intentional and peaceful, wellness ritual aesthetic.",
        cameraMovement: "rack focus",
      },
      {
        sceneType: "product",
        label: "Ingredient close-up",
        visualPrompt: "@Image3 capsule or powder in overhead macro, texture fills the frame. A few whole @Image5 botanical ingredients scattered around. Warm amber side light catches the powder shimmer. Earth tones, organic, clean composition. @Image2 product partially visible at the edge of frame.",
        cameraMovement: "overhead",
      },
      {
        sceneType: "logo",
        label: "Nature brand",
        visualPrompt: "@Image4 brand logo on kraft paper surface. @Image2 product placed beside it, @Image5 ingredient nearby. Slow push-in stops as logo fills the lower third. Warm soft morning light from the side, complete natural palette. @Image4 brand mark fully legible, @Image2 and @Image5 together tell the ingredient story.",
        cameraMovement: "slow push-in",
      },
    ],
  },
  music: {
    niche: "music",
    displayName: "Музыкальный клип / Artiste / Label",
    colorGrade: "Дерзко",
    transitionStyle: "horzopen",
    musicTempo: "fast",
    visualKeywords: [
      "dramatic rim light", "neon glow", "smoke haze", "stage light beam",
      "silhouette against light", "crowd energy", "microphone detail",
      "vinyl texture", "studio session", "street performer", "moody atmosphere",
    ],
    cameraMovements: ["tracking shot", "slow orbit", "slow push-in", "dolly back", "static"],
    imageSlotsUsage: {
      "@Image1": "Hero/model — face and body collage",
      "@Image2": "Product front view — labels and prints visible",
      "@Image3": "Product back view — other side details",
      "@Image4": "Brand logo — always in final scene",
      "@Image5": "Secondary product or accessory",
      "@Image6": "Partner logo (optional)",
    },
    promptAntiPatterns: [
      "violence", "weapons", "drug paraphernalia", "explicit gesture",
      "nudity", "gang symbols", "hate imagery",
    ],
    storyArc: [
      {
        sceneType: "nature",
        label: "Atmosphere opener",
        visualPrompt: "Dark concert venue at night, a single spotlight cuts through smoke haze onto an empty stage. Slow push-in from the back of the venue toward the light. Deep blacks, electric blue and violet beams, smoke particles in slow motion. No people yet — only atmosphere and tension.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "face",
        label: "Artist portrait",
        visualPrompt: "@Image1 stands in dramatic rim light, one powerful backlight creating a halo around the silhouette, face detail revealed in soft frontal fill. Slow orbit around @Image1 from left to right, discovering expression and presence. @Image5 stage backdrop blurred behind. Deep contrast, electric tones.",
        cameraMovement: "slow orbit",
      },
      {
        sceneType: "product",
        label: "Release reveal",
        visualPrompt: "@Image2 album cover or single artwork, slow push-in reveals detail and typography. Neon light from the side casts colour onto the surface. @Image3 instrument or mic partially visible at the edge of frame. Artwork fills 60% of frame, label or track title fully legible. Atmospheric smoke at the base.",
        cameraMovement: "slow push-in",
      },
      {
        sceneType: "action",
        label: "Performance moment",
        visualPrompt: "@Image1 in full performance energy, tracking shot follows movement from right to left. @Image5 stage light beams sweep through the background. @Image3 instrument or microphone in hand, motion blur on hands. Stage light hits @Image1 face at peak of movement. Dark and electric, authentic energy.",
        cameraMovement: "tracking shot",
      },
      {
        sceneType: "logo",
        label: "Brand signature",
        visualPrompt: "@Image4 artist or label logo on a dark surface, single warm spotlight. Static, perfectly composed — logo in lower third. Smoke settles around the frame. Electric blue and amber rim light. @Image2 artwork partially visible in the background, out of focus. @Image4 logo fully sharp and legible.",
        cameraMovement: "static",
      },
    ],
  },
};

const NICHE_KEYWORDS: Record<NicheKey, string[]> = {
  cosmetics: ["serum", "cream", "skincare", "moisturizer", "foundation", "mascara", "concealer", "toner", "essence", "spf", "retinol", "hyaluronic", "косметика", "крем", "сыворотка", "уход"],
  fashion: ["clothing", "apparel", "dress", "jacket", "shirt", "jeans", "shoes", "sneakers", "bag", "accessory", "collection", "одежда", "обувь", "аксессуары", "мода"],
  luxury: ["perfume", "fragrance", "cologne", "jewellery", "jewelry", "watch", "timepiece", "diamond", "gold", "maison", "haute", "парфюм", "духи", "ювелирка", "часы", "люкс"],
  food: ["food", "restaurant", "cafe", "coffee", "tea", "dish", "meal", "snack", "drink", "beverage", "recipe", "еда", "ресторан", "кафе", "кофе", "напиток", "блюдо"],
  fitness: ["gym", "fitness", "sport", "workout", "training", "exercise", "running", "yoga", "crossfit", "athletic", "спорт", "фитнес", "тренировка", "зал"],
  tech: ["app", "software", "device", "gadget", "phone", "laptop", "tablet", "electronics", "tech", "digital", "platform", "приложение", "гаджет", "устройство", "технологии"],
  real_estate: ["apartment", "property", "real estate", "condo", "villa", "penthouse", "developer", "квартира", "недвижимость", "жилье", "дом", "девелопер", "комплекс"],
  supplements: ["supplement", "vitamin", "protein", "collagen", "probiotic", "omega", "mineral", "extract", "wellness", "health", "бад", "витамин", "протеин", "добавка", "нутрицевтик"],
  music: ["music", "song", "album", "artist", "singer", "rapper", "band", "track", "single", "label", "release", "concert", "tour", "musician", "музыка", "песня", "альбом", "артист", "певец", "рэпер", "клип", "трек", "лейбл", "релиз"],
};

export function detectNiche(
  brandName: string,
  description: string,
  websiteContent?: string
): NicheKey {
  const text = [brandName, description, websiteContent ?? ""]
    .join(" ")
    .toLowerCase();

  const scores: Record<NicheKey, number> = {
    cosmetics: 0,
    fashion: 0,
    luxury: 0,
    food: 0,
    fitness: 0,
    tech: 0,
    real_estate: 0,
    supplements: 0,
    music: 0,
  };

  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS) as [NicheKey, string[]][]) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        scores[niche] += 1;
      }
    }
  }

  const sorted = (Object.entries(scores) as [NicheKey, number][]).sort(
    (a, b) => b[1] - a[1]
  );

  return sorted[0][1] > 0 ? sorted[0][0] : "cosmetics";
}

export function buildNicheSystemPrompt(
  niche: NicheKey,
  brandDNA: {
    brandName: string;
    productDescription: string;
    targetAudience: string;
    mood: string;
    brandImages?: string[];
  }
): string {
  const template = NICHE_TEMPLATES[niche];
  const hasImages = (brandDNA.brandImages ?? []).filter(Boolean).length > 0;

  const imageSlotBlock = hasImages
    ? `\n\nIMAGE SLOTS FOR THIS NICHE (${template.displayName}):\n${Object.entries(
        template.imageSlotsUsage
      )
        .map(([slot, desc]) => `${slot}: ${desc}`)
        .join("\n")}`
    : "";

  const antiPatternBlock = `\n\nNSFW ANTI-PATTERNS — NEVER USE THESE for ${template.displayName}:\n${template.promptAntiPatterns.map((p) => `- "${p}"`).join("\n")}`;

  const cameraBlock = `\n\nAPPROVED CAMERA MOVEMENTS for ${template.displayName}:\n${template.cameraMovements.join(" | ")}`;

  const visualBlock = `\n\nVISUAL KEYWORDS that work best for ${template.displayName}:\n${template.visualKeywords.join(", ")}`;

  const arcBlock = `\n\nSTORY ARC TEMPLATE for ${template.displayName} (adapt to this brand, don't copy literally):\n${template.storyArc
    .map(
      (scene, i) =>
        `Scene ${i + 1} — ${scene.label} (${scene.sceneType}): camera = ${scene.cameraMovement}`
    )
    .join("\n")}`;

  const styleBlock = `\n\nPRODUCTION STYLE:\n- Color grade mood: ${template.colorGrade}\n- Transition style: ${template.transitionStyle}\n- Music tempo: ${template.musicTempo}`;

  return `## NICHE CONTEXT: ${template.displayName.toUpperCase()}

Brand: ${brandDNA.brandName}
Product: ${brandDNA.productDescription}
Audience: ${brandDNA.targetAudience}
Mood: ${brandDNA.mood}${imageSlotBlock}${cameraBlock}${visualBlock}${arcBlock}${styleBlock}${antiPatternBlock}

Apply this niche knowledge to every scene. The visual keywords, camera choices, and story arc above represent what works best for ${template.displayName}. Adapt the brand's specific assets into this proven structure.`;
}

export { NICHE_TEMPLATES };
