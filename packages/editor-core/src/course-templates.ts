// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whole-course templates: a structure with placeholder text that authors
 * replace. They use theme colors, so any theme fits.
 */
import {
  DEFAULT_THEME,
  FORMAT_VERSION,
  themePreset,
  type Course,
  type Theme,
} from '@clipcourse/format';
import { AREA, blocks } from './blocks.js';
import type { IdFactory } from './document.js';
import { createQuestion } from './questions.js';

export interface CourseTemplate {
  id: string;
  name: string;
  description: string;
  /** Suggested theme preset. */
  theme: string;
  /** `size` is the stage size (default 1920×1080); the layout scales to it. */
  create(newId: IdFactory, theme?: Theme, size?: { width: number; height: number }): Course;
}

function base(
  newId: IdFactory,
  title: string,
  theme: Theme,
  size: { width: number; height: number } = { width: 1920, height: 1080 },
): Course {
  return {
    formatVersion: FORMAT_VERSION,
    id: newId('course'),
    title,
    language: 'en',
    stage: { width: size.width, height: size.height, background: 'theme:background' },
    theme: structuredClone(theme),
    assets: {},
    chapters: [],
  };
}

const presetTheme = (id: string) => themePreset(id)?.theme ?? DEFAULT_THEME;

const compliance: CourseTemplate = {
  id: 'compliance',
  name: 'Compliance training',
  description:
    'Introduction, rules, a case study with a choice, and a final quiz with a passing score of 80 %.',
  theme: 'corporate',
  create(newId, theme = presetTheme('corporate'), size) {
    const course = base(newId, 'Compliance training', theme, size);
    const b = blocks(course, newId);
    const popupId = newId('popup');
    course.popups = [
      {
        id: popupId,
        title: 'Who to contact',
        text: 'Name the person or team learners should contact, with phone and email.',
      },
    ];
    course.glossary = [
      {
        id: newId('term'),
        term: 'policy',
        definition: 'A written rule that everyone must follow.',
      },
      {
        id: newId('term'),
        term: 'incident',
        variants: ['incidents'],
        definition: 'An event that breaks a rule or could cause harm.',
      },
    ];

    const welcome = b.chapter('Welcome', [
      b.track('Title', b.text('Compliance training', AREA.title, { heading: true, size: 96 })),
      b.track(
        'Subtitle',
        b.text('About 15 minutes · ends with a short quiz', AREA.subtitle, {
          align: 'center',
          color: 'theme:muted',
          start: 800,
        }),
      ),
    ]);
    const why = b.chapter('Why it matters', [
      b.track('Title', b.text('Why it matters', AREA.heading, { heading: true, size: 72 })),
      ...['Protects people and the company', 'Required by law and our policy', 'Builds trust'].map(
        (t, i) =>
          b.track(`Point ${i + 1}`, b.text(`• ${t}`, AREA.bullet(i), { start: 1000 + i * 1500 })),
      ),
    ]);
    const rules = b.chapter('The rules', [
      b.track('Title', b.text('Three rules', AREA.heading, { heading: true, size: 72 })),
      ...[
        'Know the policy that applies to you',
        'Report every incident right away',
        'Ask when unsure',
      ].map((t, i) =>
        b.track(
          `Rule ${i + 1}`,
          b.text(`${i + 1}. ${t}`, AREA.bullet(i), { start: 1000 + i * 1500 }),
        ),
      ),
      b.track(
        'Contact',
        b.button(
          'Who to contact',
          { x: 0.65, y: 0.82, w: 0.27, h: 0.1 },
          { type: 'openPopup', popupId },
        ),
      ),
    ]);
    const quiz = b.chapter(
      'Final quiz',
      [],
      {
        quiz: {
          retries: 2,
          questions: [
            {
              kind: 'single' as const,
              id: newId('question'),
              prompt: 'What do you do first when you notice an incident?',
              choices: [
                { id: 'a', text: 'Report it right away' },
                { id: 'b', text: 'Wait and see' },
                { id: 'c', text: 'Fix it quietly' },
              ],
              correct: 'a',
            },
            {
              kind: 'multiple' as const,
              id: newId('question'),
              prompt: 'Which of these are our rules?',
              choices: [
                { id: 'a', text: 'Know the policy' },
                { id: 'b', text: 'Report incidents' },
                { id: 'c', text: 'Never ask questions' },
              ],
              correct: ['a', 'b'],
            },
            {
              kind: 'order' as const,
              id: newId('question'),
              prompt: 'Put the steps in order.',
              items: [
                { id: 'a', text: 'Notice the incident' },
                { id: 'b', text: 'Report it' },
                { id: 'c', text: 'Follow up' },
              ],
            },
          ],
        },
      },
      1000,
    );
    const right = b.chapter('Good choice', [], { optional: true });
    const wrong = b.chapter('What could happen', [], { optional: true });
    const toQuiz = { type: 'goToChapter' as const, chapterId: quiz.id };
    right.tracks = [
      b.track('Title', b.text('Good choice', AREA.title, { heading: true })),
      b.track('Text', b.text('Explain why this was right.', AREA.subtitle, { align: 'center' })),
      b.track('Next', b.button('Continue to the quiz', AREA.buttonCenter, toQuiz)),
    ];
    wrong.tracks = [
      b.track('Title', b.text('What could happen', AREA.title, { heading: true })),
      b.track(
        'Text',
        b.text('Explain the consequences, then the right way.', AREA.subtitle, { align: 'center' }),
      ),
      b.track('Next', b.button('Continue to the quiz', AREA.buttonCenter, toQuiz)),
    ];
    const caseStudy = b.chapter('Case study', [
      b.track(
        'Situation',
        b.box(
          'Describe a realistic situation from everyday work in two or three sentences.',
          AREA.center,
        ),
      ),
      b.track(
        'Choices 1',
        b.button('Report it', AREA.buttonLeft, { type: 'goToChapter', chapterId: right.id }),
      ),
      b.track(
        'Choices 2',
        b.button('Ignore it', AREA.buttonRight, { type: 'goToChapter', chapterId: wrong.id }),
      ),
    ]);
    course.chapters = [welcome, why, rules, caseStudy, right, wrong, quiz];
    course.assessment = { passingScore: 80 };
    return course;
  },
};

const onboarding: CourseTemplate = {
  id: 'onboarding',
  name: 'Onboarding / product knowledge',
  description:
    'Welcome, topic chapters with popups and a glossary, a knowledge check and a summary.',
  theme: 'light',
  create(newId, theme = presetTheme('light'), size) {
    const course = base(newId, 'Welcome aboard', theme, size);
    const b = blocks(course, newId);
    const popupId = newId('popup');
    course.popups = [
      {
        id: popupId,
        title: 'Our story',
        text: 'Tell the story of the company in a few sentences.',
      },
    ];
    course.glossary = [
      {
        id: newId('term'),
        term: 'product',
        variants: ['products'],
        definition: 'Replace with a term from your field.',
      },
    ];
    const check = b.chapter('Knowledge check', [
      b.track('Title', b.text('Quick check', AREA.heading, { heading: true, size: 72 })),
      b.track(
        'Question',
        b.question(
          {
            kind: 'single' as const,
            id: newId('question'),
            prompt: 'Which of our products fits a small team best?',
            choices: [
              { id: 'a', text: 'Product A' },
              { id: 'b', text: 'Product B' },
            ],
            correct: 'a',
            attempts: 0,
          },
          { x: 0.15, y: 0.22, w: 0.7, h: 0.7 },
          { start: 1000 },
        ),
      ),
    ]);
    course.chapters = [
      b.chapter('Welcome', [
        b.track('Title', b.text('Welcome aboard!', AREA.title, { heading: true, size: 96 })),
        b.track(
          'Subtitle',
          b.text('Everything you need for your first weeks', AREA.subtitle, {
            align: 'center',
            color: 'theme:muted',
            start: 800,
          }),
        ),
      ]),
      b.chapter('Who we are', [
        b.track('Title', b.text('Who we are', AREA.heading, { heading: true, size: 72 })),
        b.track('Text', b.text('Describe the company, its mission and its people.', AREA.left)),
        b.track(
          'More',
          b.button(
            'Our story',
            { x: 0.6, y: 0.45, w: 0.25, h: 0.1 },
            { type: 'openPopup', popupId },
          ),
        ),
      ]),
      b.chapter('Our products', [
        b.track('Title', b.text('Our products', AREA.heading, { heading: true, size: 72 })),
        b.track('Left', b.box('Product A\n\nWho it is for and what it does.', AREA.left)),
        b.track(
          'Right',
          b.box('Product B\n\nWho it is for and what it does.', AREA.right, { start: 1500 }),
        ),
      ]),
      check,
      b.chapter('Summary', [
        b.track('Title', b.text('Summary', AREA.heading, { heading: true, size: 72 })),
        b.track(
          'Box',
          b.box(
            '✓ Who we are\n✓ What we offer\n✓ Where to get help',
            { x: 0.15, y: 0.28, w: 0.7, h: 0.5 },
            { size: 48 },
          ),
        ),
      ]),
    ];
    return course;
  },
};

const micro: CourseTemplate = {
  id: 'micro',
  name: 'Micro lesson',
  description: 'One short chapter and three questions: about five minutes.',
  theme: 'nature',
  create(newId, theme = presetTheme('nature'), size) {
    const course = base(newId, 'Micro lesson', theme, size);
    const b = blocks(course, newId);
    const tip = b.text('Tip: one idea per micro lesson.', AREA.subtitle, {
      align: 'center',
      startsHidden: true,
      start: 0,
    });
    course.chapters = [
      b.chapter('The idea', [
        b.track(
          'Title',
          b.text('One idea in three points', AREA.heading, { heading: true, size: 72 }),
        ),
        ...['What it is', 'Why it helps', 'How to start'].map((t, i) =>
          b.track(
            `Point ${i + 1}`,
            b.text(
              `• ${t}`,
              { x: 0.1, y: 0.22 + i * 0.12, w: 0.8, h: 0.1 },
              { start: 1000 + i * 1500 },
            ),
          ),
        ),
        b.track('Tip', tip),
        b.track(
          'Button',
          b.button('Show a tip', AREA.buttonCenter, {
            type: 'setClipVisibility',
            clipId: tip.id,
            visible: 'show',
          }),
        ),
      ]),
      b.chapter(
        'Quick check',
        [],
        {
          quiz: {
            questions: [
              { ...createQuestion('single', newId('question')), attempts: 0 },
              { ...createQuestion('text', newId('question')), attempts: 0 },
              { ...createQuestion('match', newId('question')), attempts: 0 },
            ],
          },
        },
        1000,
      ),
    ];
    return course;
  },
};

export const COURSE_TEMPLATES: readonly CourseTemplate[] = [compliance, onboarding, micro];

export function courseTemplate(id: string): CourseTemplate | undefined {
  return COURSE_TEMPLATES.find((t) => t.id === id);
}
