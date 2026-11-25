/**
 * JustSpeak AI Partner - interview question bank (v1).
 * Fields at launch: software developer, customer service, sales.
 * Questions run easy to hard; Probe fires when an answer is short or vague.
 * Level = minimum CEFR the question suits.
 * Default persona: Rachel. Mr. Adams for formal panel style.
 */

export type InterviewFieldId = 'software' | 'customer-service' | 'sales';

export interface InterviewQuestion {
  q: string;
  probe: string;
  level: 'A2' | 'B1' | 'B2' | 'C1';
}

export interface InterviewField {
  id: InterviewFieldId;
  title: string;
  questions: InterviewQuestion[];
}

export const INTERVIEW_FIELDS: InterviewField[] = [
  {
    id: 'software',
    title: 'Software Developer',
    questions: [
      { q: 'Tell me about yourself and your experience as a developer.', probe: 'Which stack do you enjoy working with most, and why?', level: 'A2' },
      { q: 'What project are you most proud of?', probe: 'What was your exact role in it?', level: 'A2' },
      { q: 'Walk me through a bug that took you a long time to fix.', probe: 'How did you finally find the cause?', level: 'B1' },
      { q: 'How do you approach learning a new technology?', probe: 'Tell me about the last one you learned.', level: 'B1' },
      { q: 'How do you make sure your code is good quality?', probe: 'What does your review process look like?', level: 'B1' },
      { q: 'Describe a time you disagreed with a teammate about a technical decision.', probe: 'What did you do, and what was the result?', level: 'B1' },
      { q: 'How do you handle a deadline you think is unrealistic?', probe: 'Has that actually happened to you?', level: 'B2' },
      { q: 'Explain a technical concept from your work as if I knew nothing about technology.', probe: 'Now explain it in one sentence.', level: 'B2' },
      { q: 'What is the biggest technical mistake you have made?', probe: 'What did you change afterwards?', level: 'B2' },
      { q: 'How do you decide between building something yourself and using an existing tool or library?', probe: 'Give me a real example.', level: 'B2' },
      { q: 'Tell me about a time a project you worked on failed or was cancelled.', probe: 'What did you learn from it?', level: 'B2' },
      { q: 'How would you design a system that must work for millions of users?', probe: 'What would break first, and how would you know?', level: 'C1' },
      { q: 'Where do you disagree with common practice in your field?', probe: 'Defend that against the usual counter-argument.', level: 'C1' },
      { q: 'If you joined us and found our codebase in bad shape, what would you do in your first month?', probe: 'What would you deliberately NOT change yet?', level: 'C1' },
      { q: 'Why should we hire you over someone with more years of experience?', probe: 'Give me evidence, not adjectives.', level: 'C1' },
    ],
  },
  {
    id: 'customer-service',
    title: 'Customer Service',
    questions: [
      { q: 'Tell me about yourself and any experience you have with customers.', probe: 'What kind of customers did you deal with?', level: 'A2' },
      { q: 'Why do you want to work in customer service?', probe: 'What part of it do you enjoy most?', level: 'A2' },
      { q: 'A customer is angry about a late order. What do you say first?', probe: 'And if they keep shouting?', level: 'B1' },
      { q: 'Tell me about a time you turned an unhappy customer into a happy one.', probe: 'What exactly did you say?', level: 'B1' },
      { q: 'What would you do if you did not know the answer to a customer question?', probe: 'Would you ever guess an answer? Why not?', level: 'B1' },
      { q: 'How do you stay patient with a rude customer?', probe: 'Tell me about the rudest customer you have handled.', level: 'B1' },
      { q: 'A customer asks for something against company policy. What do you do?', probe: 'What if they threaten to leave a bad review?', level: 'B2' },
      { q: 'How do you handle ten customers waiting at the same time?', probe: 'Who do you help first, and why?', level: 'B2' },
      { q: 'Tell me about a mistake you made with a customer.', probe: 'How did you fix it?', level: 'B2' },
      { q: 'What does great customer service look like to you?', probe: 'Tell me about a company that does it well.', level: 'B2' },
      { q: 'A teammate keeps giving customers wrong information. What do you do?', probe: 'What if they do not listen to you?', level: 'B2' },
      { q: 'How do you deal with a customer who keeps talking and will not let you go?', probe: 'Show me how you would end that call.', level: 'B2' },
      { q: 'When would you say no to a customer, and how?', probe: 'Say the exact sentence you would use.', level: 'C1' },
      { q: 'How would you train a new agent in their first week?', probe: 'What mistake would you warn them about first?', level: 'C1' },
      { q: 'Customer service is often called a cost centre. Convince me it makes money.', probe: 'Give me a concrete example.', level: 'C1' },
    ],
  },
  {
    id: 'sales',
    title: 'Sales',
    questions: [
      { q: 'Tell me about yourself and any experience you have in sales.', probe: 'What have you sold, even informally?', level: 'A2' },
      { q: 'Why do you want to work in sales?', probe: 'What part of selling do you enjoy most?', level: 'A2' },
      { q: 'Sell me something in this room. Pick anything.', probe: 'Why should I buy it from you?', level: 'B1' },
      { q: 'Tell me about a time you convinced someone to change their mind.', probe: 'What exactly did you say?', level: 'B1' },
      { q: 'A customer says your product is too expensive. What do you say?', probe: 'And if they still hesitate?', level: 'B1' },
      { q: 'How do you find out what a customer really needs?', probe: 'Give me three questions you would ask.', level: 'B1' },
      { q: 'Tell me about a deal you lost. What happened?', probe: 'What would you do differently now?', level: 'B2' },
      { q: 'How do you handle a customer who keeps comparing you to a cheaper competitor?', probe: 'Say the exact sentence you would use.', level: 'B2' },
      { q: 'Walk me through how you would sell our product to a small business owner.', probe: 'What is your opening line?', level: 'B2' },
      { q: 'How do you keep a pipeline organised when you have twenty potential customers?', probe: 'Who do you call first, and why?', level: 'B2' },
      { q: 'Tell me about a time you had to meet a very hard target.', probe: 'Did you hit it? How?', level: 'B2' },
      { q: 'When is it right to walk away from a sale?', probe: 'Tell me about a time you did or should have.', level: 'B2' },
      { q: 'A big client wants a discount you cannot give. How do you keep them?', probe: 'What do you offer instead?', level: 'C1' },
      { q: 'Some people say sales is manipulation. Defend your profession.', probe: 'Where is the ethical line for you?', level: 'C1' },
      { q: 'How would you build a sales strategy for a new market you know nothing about?', probe: 'What would you measure in the first month?', level: 'C1' },
    ],
  },
];

export function getInterviewField(id: string | undefined): InterviewField | null {
  return INTERVIEW_FIELDS.find((field) => field.id === id) ?? null;
}
