/**
 * Seed persona profile payload (identity, narrative, attributes). No longer
 * persisted to a `user_profiles` table (dropped in WS8); identity now lives on
 * `users` and richer context lives in `user_contexts`. Retained as
 * descriptive fixture data for personas.
 */
export interface SeedProfile {
  identity: { name: string; bio: string; location: string };
  narrative: { context: string };
  attributes: { interests: string[]; skills: string[] };
}

/** Synthetic tester persona: account identity + profile + intents for db seed. */
export interface TesterPersona {
  name: string;
  email: string;
  linkedin?: string | null;
  github?: string | null;
  x?: string | null;
  website?: string | null;
  profile: SeedProfile;
  intents: string[];
}

/** Maximum number of tester personas that can be seeded in one run (0–50). */
export const TESTER_PERSONAS_MAX = 50;

/** 50 historical figure personas for seed. All deceased. */
export const TESTER_PERSONAS: TesterPersona[] = [
  // ── Warriors & Military Leaders ────────────────────────────────────────────
  {
    name: 'Miyamoto Musashi',
    email: 'seed-tester-1@index-network.test',
    profile: {
      identity: {
        name: 'Miyamoto Musashi',
        bio: 'Samurai, swordsman, and author of The Book of Five Rings. Undefeated in 61 duels.',
        location: 'Kumamoto, Japan',
      },
      narrative: { context: 'Seeking fellow martial artists and strategists to exchange techniques and philosophy of combat.' },
      attributes: {
        interests: ['swordsmanship', 'strategy', 'ink painting', 'Zen Buddhism'],
        skills: ['kenjutsu', 'dual-blade fighting', 'strategic thinking', 'calligraphy'],
      },
    },
    intents: [
      'Looking for martial arts practitioners to discuss combat philosophy and training methods.',
      'Seeking calligraphers and ink painters for artistic collaboration.',
    ],
  },
  {
    name: 'Tomoe Gozen',
    email: 'seed-tester-2@index-network.test',
    profile: {
      identity: {
        name: 'Tomoe Gozen',
        bio: 'Samurai warrior and onna-bugeisha. Known for bravery in the Genpei War and skill with the naginata.',
        location: 'Shinano Province, Japan',
      },
      narrative: { context: 'Looking for warriors, horseback riders, and martial artists who value honor and discipline.' },
      attributes: {
        interests: ['horseback archery', 'naginata', 'bushido', 'warfare'],
        skills: ['mounted combat', 'naginata mastery', 'archery', 'battlefield leadership'],
      },
    },
    intents: [
      'Seeking fellow warriors and martial artists to train and compete with.',
      'Looking for equestrians who practice mounted combat or horseback archery.',
    ],
  },
  {
    name: 'Sun Tzu',
    email: 'seed-tester-3@index-network.test',
    profile: {
      identity: {
        name: 'Sun Tzu',
        bio: 'Military strategist, general, and author of The Art of War. Advisor to the King of Wu.',
        location: 'Wu, China',
      },
      narrative: { context: 'Interested in connecting with strategic thinkers, military historians, and leadership practitioners.' },
      attributes: {
        interests: ['military strategy', 'statecraft', 'philosophy', 'logistics'],
        skills: ['strategic planning', 'military command', 'intelligence analysis', 'writing'],
      },
    },
    intents: [
      'Looking for strategists and leaders to discuss principles of conflict and competition.',
      'Seeking historians and philosophers interested in the intersection of war and governance.',
    ],
  },
  {
    name: 'Joan of Arc',
    email: 'seed-tester-4@index-network.test',
    profile: {
      identity: {
        name: 'Joan of Arc',
        bio: 'Military leader and patron saint of France. Led French forces to key victories in the Hundred Years\' War at age 17.',
        location: 'Rouen, France',
      },
      narrative: { context: 'Seeking people of conviction — leaders, organizers, and advocates for causes they believe in.' },
      attributes: {
        interests: ['military leadership', 'faith', 'national liberation', 'courage'],
        skills: ['battlefield command', 'inspirational leadership', 'siege warfare', 'horsemanship'],
      },
    },
    intents: [
      'Looking for community leaders and organizers who rally people around a shared mission.',
      'Seeking people involved in civic advocacy and grassroots movements.',
    ],
  },

  // ── Scientists & Inventors ─────────────────────────────────────────────────
  {
    name: 'Ada Lovelace',
    email: 'seed-tester-5@index-network.test',
    profile: {
      identity: {
        name: 'Ada Lovelace',
        bio: 'Mathematician and writer. Created the first computer algorithm for Charles Babbage\'s Analytical Engine.',
        location: 'London, England',
      },
      narrative: { context: 'Passionate about the intersection of mathematics and imagination. Seeking collaborators who think computationally.' },
      attributes: {
        interests: ['computing', 'mathematics', 'poetry', 'mechanical engineering'],
        skills: ['algorithm design', 'mathematical analysis', 'technical writing', 'abstract reasoning'],
      },
    },
    intents: [
      'Looking for mathematicians and engineers to explore computational theory.',
      'Seeking creative thinkers who see connections between art and science.',
    ],
  },
  {
    name: 'Nikola Tesla',
    email: 'seed-tester-6@index-network.test',
    profile: {
      identity: {
        name: 'Nikola Tesla',
        bio: 'Inventor and electrical engineer. Pioneered alternating current, wireless transmission, and rotating magnetic fields.',
        location: 'New York City, NY',
      },
      narrative: { context: 'Seeking engineers and inventors working on electricity, wireless technology, and energy systems.' },
      attributes: {
        interests: ['electrical engineering', 'wireless power', 'alternating current', 'physics'],
        skills: ['electrical system design', 'invention', 'physics research', 'mechanical engineering'],
      },
    },
    intents: [
      'Looking for electrical engineers and physicists to discuss power transmission and energy.',
      'Seeking inventors working on wireless technology or electromagnetic systems.',
    ],
  },
  {
    name: 'Marie Curie',
    email: 'seed-tester-7@index-network.test',
    profile: {
      identity: {
        name: 'Marie Curie',
        bio: 'Physicist and chemist. Discovered polonium and radium. First person to win Nobel Prizes in two different sciences.',
        location: 'Paris, France',
      },
      narrative: { context: 'Looking for researchers in physics and chemistry, especially those pushing boundaries in radioactivity and materials science.' },
      attributes: {
        interests: ['radioactivity', 'physics', 'chemistry', 'scientific research'],
        skills: ['laboratory research', 'radiation measurement', 'chemical analysis', 'scientific writing'],
      },
    },
    intents: [
      'Seeking physicists and chemists for collaboration on materials research.',
      'Looking for women in science to support and mentor.',
    ],
  },
  {
    name: 'Isaac Newton',
    email: 'seed-tester-8@index-network.test',
    profile: {
      identity: {
        name: 'Isaac Newton',
        bio: 'Mathematician, physicist, and astronomer. Developed laws of motion, universal gravitation, and calculus.',
        location: 'Cambridge, England',
      },
      narrative: { context: 'Interested in connecting with mathematicians, opticians, and natural philosophers.' },
      attributes: {
        interests: ['mathematics', 'physics', 'optics', 'alchemy'],
        skills: ['calculus', 'theoretical physics', 'telescope design', 'mathematical proof'],
      },
    },
    intents: [
      'Looking for mathematicians to debate methods of calculus and infinite series.',
      'Seeking opticians and lens-makers interested in light and color theory.',
    ],
  },
  {
    name: 'Charles Darwin',
    email: 'seed-tester-9@index-network.test',
    profile: {
      identity: {
        name: 'Charles Darwin',
        bio: 'Naturalist and biologist. Developed the theory of evolution by natural selection.',
        location: 'Down House, Kent, England',
      },
      narrative: { context: 'Seeking naturalists, breeders, and geologists to exchange observations on species variation.' },
      attributes: {
        interests: ['natural history', 'evolution', 'geology', 'taxonomy'],
        skills: ['specimen collection', 'field observation', 'scientific writing', 'taxonomic classification'],
      },
    },
    intents: [
      'Looking for naturalists and biologists studying species adaptation and variation.',
      'Seeking plant and animal breeders to discuss heredity and selection.',
    ],
  },
  {
    name: 'Galileo Galilei',
    email: 'seed-tester-10@index-network.test',
    profile: {
      identity: {
        name: 'Galileo Galilei',
        bio: 'Astronomer, physicist, and engineer. Father of observational astronomy and modern physics.',
        location: 'Florence, Italy',
      },
      narrative: { context: 'Seeking astronomers, mathematicians, and instrument makers to advance our understanding of the heavens.' },
      attributes: {
        interests: ['astronomy', 'physics', 'telescope design', 'mathematics'],
        skills: ['astronomical observation', 'telescope construction', 'experimental physics', 'mathematical modeling'],
      },
    },
    intents: [
      'Looking for astronomers and telescope makers to improve celestial observation.',
      'Seeking mathematicians interested in the physics of motion and mechanics.',
    ],
  },

  // ── Artists & Architects ───────────────────────────────────────────────────
  {
    name: 'Leonardo da Vinci',
    email: 'seed-tester-11@index-network.test',
    profile: {
      identity: {
        name: 'Leonardo da Vinci',
        bio: 'Painter, engineer, anatomist, and inventor. Created the Mona Lisa and Vitruvian Man. Polymath of the Renaissance.',
        location: 'Florence, Italy',
      },
      narrative: { context: 'Seeking collaborators across art, engineering, anatomy, and invention — the boundaries between disciplines are illusions.' },
      attributes: {
        interests: ['painting', 'anatomy', 'engineering', 'flight', 'hydraulics'],
        skills: ['oil painting', 'anatomical drawing', 'mechanical design', 'architectural drafting'],
      },
    },
    intents: [
      'Looking for engineers and artists working at the intersection of art and science.',
      'Seeking anatomists and physicians to collaborate on studies of the human body.',
    ],
  },
  {
    name: 'Frida Kahlo',
    email: 'seed-tester-12@index-network.test',
    profile: {
      identity: {
        name: 'Frida Kahlo',
        bio: 'Painter known for vivid self-portraits and works inspired by Mexican folk art. Icon of surrealism and feminist art.',
        location: 'Mexico City, Mexico',
      },
      narrative: { context: 'Looking for artists who paint from lived experience — especially those exploring identity, pain, and culture.' },
      attributes: {
        interests: ['painting', 'Mexican folk art', 'surrealism', 'political activism'],
        skills: ['oil painting', 'self-portraiture', 'color composition', 'mixed media'],
      },
    },
    intents: [
      'Seeking painters and visual artists exploring identity and cultural heritage in their work.',
      'Looking for activists and organizers in the arts community.',
    ],
  },
  {
    name: 'Michelangelo Buonarroti',
    email: 'seed-tester-13@index-network.test',
    profile: {
      identity: {
        name: 'Michelangelo Buonarroti',
        bio: 'Sculptor, painter, architect, and poet. Created the ceiling of the Sistine Chapel and the statue of David.',
        location: 'Rome, Italy',
      },
      narrative: { context: 'Seeking sculptors, architects, and patrons who understand that art demands total commitment.' },
      attributes: {
        interests: ['sculpture', 'architecture', 'fresco painting', 'poetry'],
        skills: ['marble carving', 'fresco technique', 'architectural design', 'figure drawing'],
      },
    },
    intents: [
      'Looking for sculptors and stone carvers to exchange techniques.',
      'Seeking architects working on monumental public buildings or sacred spaces.',
    ],
  },
  {
    name: 'Zaha Hadid',
    email: 'seed-tester-14@index-network.test',
    profile: {
      identity: {
        name: 'Zaha Hadid',
        bio: 'Architect known for radical deconstructivist designs. First woman to win the Pritzker Architecture Prize.',
        location: 'London, England',
      },
      narrative: { context: 'Seeking architects, parametric designers, and structural engineers who push beyond conventional form.' },
      attributes: {
        interests: ['architecture', 'parametric design', 'urbanism', 'mathematics'],
        skills: ['architectural design', 'parametric modeling', 'urban planning', 'conceptual drawing'],
      },
    },
    intents: [
      'Looking for architects and designers experimenting with fluid, non-rectilinear forms.',
      'Seeking structural engineers willing to solve problems conventional engineers avoid.',
    ],
  },

  // ── Musicians & Composers ──────────────────────────────────────────────────
  {
    name: 'Ludwig van Beethoven',
    email: 'seed-tester-15@index-network.test',
    profile: {
      identity: {
        name: 'Ludwig van Beethoven',
        bio: 'Composer and pianist. Bridged Classical and Romantic eras. Continued composing masterworks after losing his hearing.',
        location: 'Vienna, Austria',
      },
      narrative: { context: 'Seeking musicians, especially pianists and orchestral composers, to discuss form, expression, and the limits of music.' },
      attributes: {
        interests: ['composition', 'piano', 'symphonic music', 'music theory'],
        skills: ['orchestral composition', 'piano performance', 'improvisation', 'counterpoint'],
      },
    },
    intents: [
      'Looking for composers and musicians to discuss symphonic form and emotional expression.',
      'Seeking pianists interested in performing and interpreting complex works.',
    ],
  },
  {
    name: 'Umm Kulthum',
    email: 'seed-tester-16@index-network.test',
    profile: {
      identity: {
        name: 'Umm Kulthum',
        bio: 'Egyptian singer, songwriter, and actress. The Star of the East — one of the greatest vocalists of the 20th century.',
        location: 'Cairo, Egypt',
      },
      narrative: { context: 'Seeking vocalists, poets, and composers who understand that a single phrase can hold an entire world.' },
      attributes: {
        interests: ['vocal performance', 'Arabic music', 'poetry', 'classical maqam'],
        skills: ['singing', 'maqam interpretation', 'audience connection', 'vocal improvisation'],
      },
    },
    intents: [
      'Looking for vocalists and musicians working in Arabic classical and folk traditions.',
      'Seeking poets and lyricists for collaboration on sung poetry.',
    ],
  },
  {
    name: 'Johann Sebastian Bach',
    email: 'seed-tester-17@index-network.test',
    profile: {
      identity: {
        name: 'Johann Sebastian Bach',
        bio: 'Composer and organist. Master of counterpoint, fugue, and sacred music. Prolific creator of cantatas and concertos.',
        location: 'Leipzig, Germany',
      },
      narrative: { context: 'Seeking organists, choir directors, and composers interested in the architecture of polyphonic music.' },
      attributes: {
        interests: ['counterpoint', 'organ music', 'sacred music', 'music pedagogy'],
        skills: ['fugue composition', 'organ performance', 'choral direction', 'music teaching'],
      },
    },
    intents: [
      'Looking for organists and keyboard players to exchange repertoire and technique.',
      'Seeking choir directors and sacred music practitioners for collaboration.',
    ],
  },

  // ── Philosophers & Writers ─────────────────────────────────────────────────
  {
    name: 'Hypatia of Alexandria',
    email: 'seed-tester-18@index-network.test',
    profile: {
      identity: {
        name: 'Hypatia of Alexandria',
        bio: 'Philosopher, mathematician, and astronomer. Head of the Neoplatonic school in Alexandria. Renowned teacher and scholar.',
        location: 'Alexandria, Egypt',
      },
      narrative: { context: 'Seeking scholars, mathematicians, and philosophers for intellectual exchange and teaching collaboration.' },
      attributes: {
        interests: ['philosophy', 'mathematics', 'astronomy', 'teaching'],
        skills: ['philosophical reasoning', 'mathematical instruction', 'astronomical calculation', 'public lecturing'],
      },
    },
    intents: [
      'Looking for mathematicians and philosophers to discuss Neoplatonic thought and geometry.',
      'Seeking educators and scholars committed to open intellectual inquiry.',
    ],
  },
  {
    name: 'William Shakespeare',
    email: 'seed-tester-19@index-network.test',
    profile: {
      identity: {
        name: 'William Shakespeare',
        bio: 'Playwright, poet, and actor. Wrote 37 plays and 154 sonnets that defined English literature.',
        location: 'London, England',
      },
      narrative: { context: 'Seeking actors, directors, and fellow playwrights — the stage is where words become flesh.' },
      attributes: {
        interests: ['theater', 'poetry', 'storytelling', 'English language'],
        skills: ['playwriting', 'sonnet composition', 'dramatic structure', 'acting'],
      },
    },
    intents: [
      'Looking for actors and theater companies interested in performing new and classic works.',
      'Seeking poets and writers to discuss dramatic form and the craft of language.',
    ],
  },
  {
    name: 'Rumi',
    email: 'seed-tester-20@index-network.test',
    profile: {
      identity: {
        name: 'Rumi',
        bio: 'Persian poet, Sufi mystic, and scholar. Author of the Masnavi, one of the greatest works of mystical poetry.',
        location: 'Konya, Turkey',
      },
      narrative: { context: 'Seeking poets, musicians, and spiritual seekers — those who understand that love is the only language.' },
      attributes: {
        interests: ['poetry', 'Sufism', 'music', 'spiritual philosophy'],
        skills: ['mystical poetry', 'philosophical writing', 'spiritual teaching', 'whirling meditation'],
      },
    },
    intents: [
      'Looking for poets and writers exploring spiritual and mystical themes.',
      'Seeking musicians, especially reed flute and percussion players, for Sufi gatherings.',
    ],
  },
  {
    name: 'Murasaki Shikibu',
    email: 'seed-tester-21@index-network.test',
    profile: {
      identity: {
        name: 'Murasaki Shikibu',
        bio: 'Novelist, poet, and lady-in-waiting at the Japanese imperial court. Author of The Tale of Genji, the world\'s first novel.',
        location: 'Kyoto, Japan',
      },
      narrative: { context: 'Seeking writers, poets, and observers of human nature who find meaning in the details of daily life.' },
      attributes: {
        interests: ['novel writing', 'poetry', 'court culture', 'human psychology'],
        skills: ['narrative prose', 'character development', 'waka poetry', 'observational writing'],
      },
    },
    intents: [
      'Looking for novelists and fiction writers to discuss narrative technique and character.',
      'Seeking poets working in short-form verse traditions.',
    ],
  },
  {
    name: 'Marcus Aurelius',
    email: 'seed-tester-22@index-network.test',
    profile: {
      identity: {
        name: 'Marcus Aurelius',
        bio: 'Roman Emperor and Stoic philosopher. Author of Meditations, a foundational text of Stoic thought.',
        location: 'Rome, Italy',
      },
      narrative: { context: 'Seeking leaders, philosophers, and anyone who struggles to act justly under pressure.' },
      attributes: {
        interests: ['Stoic philosophy', 'governance', 'ethics', 'self-discipline'],
        skills: ['philosophical writing', 'statecraft', 'leadership', 'ethical reasoning'],
      },
    },
    intents: [
      'Looking for philosophers and ethicists to discuss virtue, duty, and Stoic practice.',
      'Seeking leaders dealing with difficult decisions who value reflective practice.',
    ],
  },

  // ── Financiers & Merchants ─────────────────────────────────────────────────
  {
    name: 'J.P. Morgan',
    email: 'seed-tester-23@index-network.test',
    profile: {
      identity: {
        name: 'J.P. Morgan',
        bio: 'Financier and banker. Founded J.P. Morgan & Co. Organized the financing of major railroads and U.S. Steel.',
        location: 'New York City, NY',
      },
      narrative: { context: 'Seeking industrialists, entrepreneurs, and financiers building enterprises that require serious capital.' },
      attributes: {
        interests: ['finance', 'banking', 'industrial consolidation', 'art collecting'],
        skills: ['corporate finance', 'deal structuring', 'risk assessment', 'capital allocation'],
      },
    },
    intents: [
      'Looking for entrepreneurs and industrialists who need investment capital for large ventures.',
      'Seeking financiers and bankers to discuss syndication and deal structure.',
    ],
  },
  {
    name: 'Mansa Musa',
    email: 'seed-tester-24@index-network.test',
    profile: {
      identity: {
        name: 'Mansa Musa',
        bio: 'Emperor of the Mali Empire and the wealthiest person in recorded history. Patron of trade, education, and architecture.',
        location: 'Timbuktu, Mali',
      },
      narrative: { context: 'Seeking traders, scholars, and architects — wealth means nothing if it does not build civilization.' },
      attributes: {
        interests: ['trade', 'education', 'architecture', 'Islamic scholarship'],
        skills: ['empire administration', 'trade route management', 'patronage', 'diplomatic negotiation'],
      },
    },
    intents: [
      'Looking for traders and merchants operating across international routes.',
      'Seeking architects and educators to build universities and libraries.',
    ],
  },
  {
    name: 'Cosimo de\' Medici',
    email: 'seed-tester-25@index-network.test',
    profile: {
      identity: {
        name: 'Cosimo de\' Medici',
        bio: 'Banker, patron of the arts, and founder of the Medici political dynasty. Financed the Italian Renaissance.',
        location: 'Florence, Italy',
      },
      narrative: { context: 'Seeking artists, architects, and scholars who need patronage — and bankers who understand that culture is wealth.' },
      attributes: {
        interests: ['banking', 'art patronage', 'architecture', 'classical scholarship'],
        skills: ['banking operations', 'political strategy', 'arts patronage', 'diplomatic negotiation'],
      },
    },
    intents: [
      'Looking for artists and architects seeking patronage for ambitious projects.',
      'Seeking bankers and financiers interested in cultural investment.',
    ],
  },

  // ── Explorers & Navigators ─────────────────────────────────────────────────
  {
    name: 'Ibn Battuta',
    email: 'seed-tester-26@index-network.test',
    profile: {
      identity: {
        name: 'Ibn Battuta',
        bio: 'Explorer and scholar. Traveled over 70,000 miles across Africa, Asia, and Europe over 30 years.',
        location: 'Tangier, Morocco',
      },
      narrative: { context: 'Seeking travelers, geographers, and cultural observers who believe the world is best understood by walking through it.' },
      attributes: {
        interests: ['travel', 'geography', 'Islamic law', 'cultural observation'],
        skills: ['navigation', 'travel writing', 'language learning', 'cross-cultural diplomacy'],
      },
    },
    intents: [
      'Looking for travelers and geographers to compare notes on distant lands.',
      'Seeking translators and linguists for multi-language collaboration.',
    ],
  },
  {
    name: 'Amelia Earhart',
    email: 'seed-tester-27@index-network.test',
    profile: {
      identity: {
        name: 'Amelia Earhart',
        bio: 'Aviator and author. First woman to fly solo across the Atlantic Ocean. Advocate for women in aviation.',
        location: 'Atchison, Kansas',
      },
      narrative: { context: 'Seeking pilots, engineers, and adventurers who refuse to accept limits others set for them.' },
      attributes: {
        interests: ['aviation', 'navigation', 'women\'s rights', 'adventure'],
        skills: ['piloting', 'celestial navigation', 'mechanical repair', 'public speaking'],
      },
    },
    intents: [
      'Looking for aviators and aerospace engineers to discuss long-distance flight.',
      'Seeking women in technical fields for mutual support and collaboration.',
    ],
  },

  // ── Political Leaders & Activists ──────────────────────────────────────────
  {
    name: 'Mahatma Gandhi',
    email: 'seed-tester-28@index-network.test',
    profile: {
      identity: {
        name: 'Mahatma Gandhi',
        bio: 'Lawyer, anti-colonial activist, and leader of Indian independence. Pioneer of nonviolent civil disobedience.',
        location: 'Ahmedabad, India',
      },
      narrative: { context: 'Seeking organizers, lawyers, and activists committed to justice through nonviolent means.' },
      attributes: {
        interests: ['nonviolence', 'civil rights', 'self-governance', 'communal living'],
        skills: ['community organizing', 'nonviolent protest', 'legal advocacy', 'public speaking'],
      },
    },
    intents: [
      'Looking for community organizers and activists practicing nonviolent resistance.',
      'Seeking lawyers and advocates working on civil rights and social justice.',
    ],
  },
  {
    name: 'Cleopatra VII',
    email: 'seed-tester-29@index-network.test',
    profile: {
      identity: {
        name: 'Cleopatra VII',
        bio: 'Pharaoh of Egypt, diplomat, and naval commander. Ruled Egypt for 21 years through political acumen and strategic alliances.',
        location: 'Alexandria, Egypt',
      },
      narrative: { context: 'Seeking diplomats, strategists, and leaders who understand that power requires both intelligence and alliance.' },
      attributes: {
        interests: ['diplomacy', 'naval strategy', 'languages', 'trade policy'],
        skills: ['multilingual diplomacy', 'political negotiation', 'fleet command', 'statecraft'],
      },
    },
    intents: [
      'Looking for diplomats and negotiators skilled in multi-party alliance building.',
      'Seeking linguists and translators — I speak nine languages and value polyglots.',
    ],
  },
  {
    name: 'Nelson Mandela',
    email: 'seed-tester-30@index-network.test',
    profile: {
      identity: {
        name: 'Nelson Mandela',
        bio: 'Anti-apartheid activist, political prisoner for 27 years, and first Black president of South Africa.',
        location: 'Johannesburg, South Africa',
      },
      narrative: { context: 'Seeking leaders, educators, and peacebuilders committed to reconciliation and justice.' },
      attributes: {
        interests: ['reconciliation', 'education', 'human rights', 'constitutional law'],
        skills: ['negotiation', 'public speaking', 'constitutional drafting', 'coalition building'],
      },
    },
    intents: [
      'Looking for peacebuilders and mediators working on post-conflict reconciliation.',
      'Seeking educators building programs for civic engagement and democracy.',
    ],
  },

  // ── Mathematicians ─────────────────────────────────────────────────────────
  {
    name: 'Srinivasa Ramanujan',
    email: 'seed-tester-31@index-network.test',
    profile: {
      identity: {
        name: 'Srinivasa Ramanujan',
        bio: 'Mathematician who made extraordinary contributions to number theory, infinite series, and continued fractions with almost no formal training.',
        location: 'Kumbakonam, India',
      },
      narrative: { context: 'Seeking mathematicians — I have notebooks full of theorems that need proof and colleagues who need ideas.' },
      attributes: {
        interests: ['number theory', 'infinite series', 'continued fractions', 'mathematical analysis'],
        skills: ['mathematical intuition', 'series summation', 'partition theory', 'modular forms'],
      },
    },
    intents: [
      'Looking for mathematicians working on number theory and analytic functions.',
      'Seeking academic mentors and collaborators to formalize unproven results.',
    ],
  },
  {
    name: 'Emmy Noether',
    email: 'seed-tester-32@index-network.test',
    profile: {
      identity: {
        name: 'Emmy Noether',
        bio: 'Mathematician who revolutionized abstract algebra and proved the fundamental theorem linking symmetry and conservation laws.',
        location: 'Gottingen, Germany',
      },
      narrative: { context: 'Seeking algebraists, physicists, and anyone who understands that the deepest truths are structural.' },
      attributes: {
        interests: ['abstract algebra', 'ring theory', 'physics', 'mathematical pedagogy'],
        skills: ['algebraic theory', 'mathematical proof', 'teaching', 'theoretical physics collaboration'],
      },
    },
    intents: [
      'Looking for algebraists and ring theorists for research collaboration.',
      'Seeking physicists interested in the mathematical foundations of conservation laws.',
    ],
  },

  // ── Physicians & Healers ───────────────────────────────────────────────────
  {
    name: 'Ibn Sina',
    email: 'seed-tester-33@index-network.test',
    profile: {
      identity: {
        name: 'Ibn Sina',
        bio: 'Physician, philosopher, and polymath. Author of The Canon of Medicine, the standard medical text for 600 years.',
        location: 'Isfahan, Persia',
      },
      narrative: { context: 'Seeking physicians, pharmacists, and philosophers — medicine is philosophy applied to the body.' },
      attributes: {
        interests: ['medicine', 'philosophy', 'pharmacology', 'astronomy'],
        skills: ['clinical diagnosis', 'pharmaceutical preparation', 'philosophical writing', 'medical education'],
      },
    },
    intents: [
      'Looking for physicians and medical researchers to discuss clinical methods.',
      'Seeking pharmacists and herbalists for exchange on medicinal compounds.',
    ],
  },
  {
    name: 'Florence Nightingale',
    email: 'seed-tester-34@index-network.test',
    profile: {
      identity: {
        name: 'Florence Nightingale',
        bio: 'Nurse, statistician, and social reformer. Founded modern nursing and pioneered the use of data visualization in healthcare.',
        location: 'London, England',
      },
      narrative: { context: 'Seeking nurses, statisticians, and public health advocates — sanitation saves more lives than surgery.' },
      attributes: {
        interests: ['nursing', 'statistics', 'public health', 'hospital reform'],
        skills: ['nursing practice', 'statistical analysis', 'data visualization', 'institutional reform'],
      },
    },
    intents: [
      'Looking for nurses and healthcare workers interested in improving patient care standards.',
      'Seeking statisticians who can apply data analysis to public health problems.',
    ],
  },

  // ── Athletes & Coaches ─────────────────────────────────────────────────────
  {
    name: 'Jesse Owens',
    email: 'seed-tester-35@index-network.test',
    profile: {
      identity: {
        name: 'Jesse Owens',
        bio: 'Track and field athlete. Won four gold medals at the 1936 Berlin Olympics, defying Nazi ideology.',
        location: 'Cleveland, Ohio',
      },
      narrative: { context: 'Seeking athletes, coaches, and anyone who believes that excellence is the best answer to prejudice.' },
      attributes: {
        interests: ['track and field', 'sprinting', 'long jump', 'youth athletics'],
        skills: ['sprinting', 'long jump', 'athletic training', 'motivational speaking'],
      },
    },
    intents: [
      'Looking for track and field athletes and coaches to train and compete with.',
      'Seeking youth sports programs that use athletics to build character.',
    ],
  },
  {
    name: 'Jigoro Kano',
    email: 'seed-tester-36@index-network.test',
    profile: {
      identity: {
        name: 'Jigoro Kano',
        bio: 'Martial artist and educator. Founder of judo and pioneer of modern martial arts pedagogy.',
        location: 'Tokyo, Japan',
      },
      narrative: { context: 'Seeking martial artists and educators — the goal of judo is mutual welfare and benefit, not mere victory.' },
      attributes: {
        interests: ['judo', 'martial arts education', 'physical education', 'Olympic movement'],
        skills: ['judo instruction', 'curriculum design', 'martial arts philosophy', 'sports governance'],
      },
    },
    intents: [
      'Looking for martial arts instructors to discuss pedagogy and training methods.',
      'Seeking educators interested in physical education reform.',
    ],
  },

  // ── Makers & Craftspeople ──────────────────────────────────────────────────
  {
    name: 'Benvenuto Cellini',
    email: 'seed-tester-37@index-network.test',
    profile: {
      identity: {
        name: 'Benvenuto Cellini',
        bio: 'Goldsmith, sculptor, and author. Created the Perseus with the Head of Medusa and the Cellini Salt Cellar.',
        location: 'Florence, Italy',
      },
      narrative: { context: 'Seeking goldsmiths, sculptors, and craftspeople who believe that the hands know things the mind cannot.' },
      attributes: {
        interests: ['goldsmithing', 'bronze casting', 'sculpture', 'jewelry'],
        skills: ['metalworking', 'lost-wax casting', 'engraving', 'jewelry design'],
      },
    },
    intents: [
      'Looking for goldsmiths and metalworkers to exchange casting and engraving techniques.',
      'Seeking sculptors working in bronze who understand monumental commissions.',
    ],
  },
  {
    name: 'Hokusai',
    email: 'seed-tester-38@index-network.test',
    profile: {
      identity: {
        name: 'Katsushika Hokusai',
        bio: 'Ukiyo-e painter and printmaker. Created The Great Wave off Kanagawa. Produced over 30,000 works in 70 years.',
        location: 'Edo (Tokyo), Japan',
      },
      narrative: { context: 'Seeking printmakers, painters, and anyone obsessed with mastering their craft over a lifetime.' },
      attributes: {
        interests: ['woodblock printing', 'painting', 'manga', 'nature studies'],
        skills: ['ukiyo-e printmaking', 'brush painting', 'landscape composition', 'book illustration'],
      },
    },
    intents: [
      'Looking for printmakers and woodblock artists to discuss technique and composition.',
      'Seeking painters who share a lifelong obsession with depicting nature.',
    ],
  },

  // ── Educators & Knowledge Workers ──────────────────────────────────────────
  {
    name: 'Confucius',
    email: 'seed-tester-39@index-network.test',
    profile: {
      identity: {
        name: 'Confucius',
        bio: 'Philosopher, teacher, and political advisor. Founded Confucianism and established principles of ethics, family, and governance.',
        location: 'Qufu, China',
      },
      narrative: { context: 'Seeking teachers, civic leaders, and anyone who believes that a just society begins with self-cultivation.' },
      attributes: {
        interests: ['ethics', 'education', 'governance', 'ritual propriety'],
        skills: ['philosophical teaching', 'ethical reasoning', 'classical scholarship', 'political advising'],
      },
    },
    intents: [
      'Looking for educators and teachers committed to moral and civic education.',
      'Seeking government officials and leaders interested in ethical governance.',
    ],
  },
  {
    name: 'Maria Montessori',
    email: 'seed-tester-40@index-network.test',
    profile: {
      identity: {
        name: 'Maria Montessori',
        bio: 'Physician and educator. Developed the Montessori method of child-centered education used worldwide.',
        location: 'Rome, Italy',
      },
      narrative: { context: 'Seeking educators, child psychologists, and school founders who trust children to lead their own learning.' },
      attributes: {
        interests: ['education', 'child development', 'psychology', 'school design'],
        skills: ['educational methodology', 'classroom design', 'child observation', 'teacher training'],
      },
    },
    intents: [
      'Looking for educators starting or running schools based on child-centered methods.',
      'Seeking child psychologists researching developmental learning.',
    ],
  },

  // ── Engineers & Builders ───────────────────────────────────────────────────
  {
    name: 'Isambard Kingdom Brunel',
    email: 'seed-tester-41@index-network.test',
    profile: {
      identity: {
        name: 'Isambard Kingdom Brunel',
        bio: 'Civil and mechanical engineer. Designed the Great Western Railway, the SS Great Britain, and the Clifton Suspension Bridge.',
        location: 'Bristol, England',
      },
      narrative: { context: 'Seeking engineers, shipbuilders, and anyone who thinks in iron and steam.' },
      attributes: {
        interests: ['civil engineering', 'railways', 'shipbuilding', 'bridge design'],
        skills: ['structural engineering', 'railway design', 'ship construction', 'tunnel boring'],
      },
    },
    intents: [
      'Looking for civil engineers and structural designers working on bridges and tunnels.',
      'Seeking shipbuilders and naval architects to discuss iron-hulled vessel design.',
    ],
  },
  {
    name: 'Imhotep',
    email: 'seed-tester-42@index-network.test',
    profile: {
      identity: {
        name: 'Imhotep',
        bio: 'Architect, physician, and vizier. Designed the Step Pyramid of Djoser — the first monumental stone building in history.',
        location: 'Memphis, Egypt',
      },
      narrative: { context: 'Seeking architects, physicians, and builders who understand that to build for eternity requires mastery of many arts.' },
      attributes: {
        interests: ['architecture', 'medicine', 'astronomy', 'stone masonry'],
        skills: ['architectural design', 'stone construction', 'medical practice', 'administrative leadership'],
      },
    },
    intents: [
      'Looking for architects and builders working on monumental construction projects.',
      'Seeking physicians and healers to exchange medical knowledge.',
    ],
  },

  // ── Chefs & Food Culture ───────────────────────────────────────────────────
  {
    name: 'Auguste Escoffier',
    email: 'seed-tester-43@index-network.test',
    profile: {
      identity: {
        name: 'Auguste Escoffier',
        bio: 'Chef, restaurateur, and culinary writer. Modernized French cuisine and codified the brigade kitchen system.',
        location: 'Paris, France',
      },
      narrative: { context: 'Seeking chefs, restaurateurs, and food writers who treat cooking as both art and discipline.' },
      attributes: {
        interests: ['French cuisine', 'kitchen management', 'culinary writing', 'hospitality'],
        skills: ['classical cooking technique', 'menu design', 'kitchen brigade management', 'recipe development'],
      },
    },
    intents: [
      'Looking for chefs and cooks to discuss technique, menu design, and kitchen organization.',
      'Seeking restaurateurs and hospitality professionals building dining experiences.',
    ],
  },

  // ── Photographers & Documentarians ─────────────────────────────────────────
  {
    name: 'Dorothea Lange',
    email: 'seed-tester-44@index-network.test',
    profile: {
      identity: {
        name: 'Dorothea Lange',
        bio: 'Documentary photographer. Her images of Depression-era America, especially Migrant Mother, defined an era.',
        location: 'San Francisco, CA',
      },
      narrative: { context: 'Seeking photographers, journalists, and social workers who believe images can move people to action.' },
      attributes: {
        interests: ['documentary photography', 'social justice', 'photojournalism', 'portraiture'],
        skills: ['portrait photography', 'documentary storytelling', 'darkroom printing', 'field reporting'],
      },
    },
    intents: [
      'Looking for photographers and photojournalists documenting social conditions.',
      'Seeking social workers and advocates who need visual documentation of their work.',
    ],
  },

  // ── Game Designers & Strategists ───────────────────────────────────────────
  {
    name: 'Alexander Alekhine',
    email: 'seed-tester-45@index-network.test',
    profile: {
      identity: {
        name: 'Alexander Alekhine',
        bio: 'Chess grandmaster and World Chess Champion. Known for aggressive, combinational play and deep preparation.',
        location: 'Paris, France',
      },
      narrative: { context: 'Seeking chess players, game theorists, and strategic thinkers who enjoy deep combinational analysis.' },
      attributes: {
        interests: ['chess', 'game theory', 'combinatorics', 'competitive strategy'],
        skills: ['chess mastery', 'opening preparation', 'tactical calculation', 'tournament play'],
      },
    },
    intents: [
      'Looking for chess players for competitive matches and analysis sessions.',
      'Seeking game theorists and strategists interested in decision-making under uncertainty.',
    ],
  },

  // ── Community Builders & Social Reformers ──────────────────────────────────
  {
    name: 'Jane Addams',
    email: 'seed-tester-46@index-network.test',
    profile: {
      identity: {
        name: 'Jane Addams',
        bio: 'Social reformer, settlement house founder, and Nobel Peace Prize laureate. Founded Hull House in Chicago.',
        location: 'Chicago, Illinois',
      },
      narrative: { context: 'Seeking community organizers, social workers, and educators building institutions that serve their neighborhoods.' },
      attributes: {
        interests: ['settlement houses', 'social work', 'women\'s suffrage', 'peace activism'],
        skills: ['community organizing', 'program design', 'fundraising', 'public advocacy'],
      },
    },
    intents: [
      'Looking for community organizers building neighborhood institutions and mutual aid programs.',
      'Seeking social workers and educators focused on immigrant and working-class communities.',
    ],
  },

  // ── Naturalists & Environmentalists ────────────────────────────────────────
  {
    name: 'Alexander von Humboldt',
    email: 'seed-tester-47@index-network.test',
    profile: {
      identity: {
        name: 'Alexander von Humboldt',
        bio: 'Naturalist, explorer, and geographer. Pioneered biogeography and ecological thinking. Explored South America for five years.',
        location: 'Berlin, Germany',
      },
      narrative: { context: 'Seeking naturalists, botanists, and geographers — everything in nature is connected, and we must map those connections.' },
      attributes: {
        interests: ['biogeography', 'botany', 'climatology', 'exploration'],
        skills: ['field research', 'scientific illustration', 'geographic mapping', 'ecological analysis'],
      },
    },
    intents: [
      'Looking for naturalists and botanists for collaborative field expeditions.',
      'Seeking geographers and climate scientists to map ecological relationships.',
    ],
  },

  // ── Textile & Fashion ──────────────────────────────────────────────────────
  {
    name: 'Coco Chanel',
    email: 'seed-tester-48@index-network.test',
    profile: {
      identity: {
        name: 'Coco Chanel',
        bio: 'Fashion designer who revolutionized women\'s fashion. Created Chanel No. 5, the little black dress, and the Chanel suit.',
        location: 'Paris, France',
      },
      narrative: { context: 'Seeking designers, textile artisans, and anyone who understands that elegance is refusal.' },
      attributes: {
        interests: ['fashion design', 'textile innovation', 'perfumery', 'brand building'],
        skills: ['garment design', 'textile selection', 'brand identity', 'trend forecasting'],
      },
    },
    intents: [
      'Looking for fashion designers and textile artisans for collaboration on collections.',
      'Seeking perfumers and fragrance chemists interested in scent design.',
    ],
  },

  // ── Astronomers ────────────────────────────────────────────────────────────
  {
    name: 'Nicolaus Copernicus',
    email: 'seed-tester-49@index-network.test',
    profile: {
      identity: {
        name: 'Nicolaus Copernicus',
        bio: 'Astronomer and mathematician. Formulated the heliocentric model of the solar system, placing the Sun at the center.',
        location: 'Frombork, Poland',
      },
      narrative: { context: 'Seeking astronomers, mathematicians, and anyone willing to question what everyone else takes for granted.' },
      attributes: {
        interests: ['astronomy', 'mathematics', 'cosmology', 'optics'],
        skills: ['astronomical observation', 'mathematical modeling', 'cosmological theory', 'canon law'],
      },
    },
    intents: [
      'Looking for astronomers and mathematicians to discuss planetary motion models.',
      'Seeking instrument makers who can build better observational tools.',
    ],
  },

  // ── Ceramicists & Potters ──────────────────────────────────────────────────
  {
    name: 'Bernard Leach',
    email: 'seed-tester-50@index-network.test',
    profile: {
      identity: {
        name: 'Bernard Leach',
        bio: 'Potter and art educator. Father of British studio pottery. Bridged Eastern and Western ceramic traditions.',
        location: 'St Ives, Cornwall, England',
      },
      narrative: { context: 'Seeking potters, ceramicists, and craft practitioners who believe in the beauty of functional objects.' },
      attributes: {
        interests: ['ceramics', 'pottery', 'Japanese aesthetics', 'craft philosophy'],
        skills: ['wheel throwing', 'glaze chemistry', 'kiln building', 'ceramic teaching'],
      },
    },
    intents: [
      'Looking for potters and ceramicists to share techniques across Eastern and Western traditions.',
      'Seeking craft practitioners interested in the philosophy of handmade objects.',
    ],
  },
];
