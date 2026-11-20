import type { DemoScript } from '@x10/shared/demo';

const CLOSED = 'AI Agents Bootcamp: Day 1 (demo)';

export const script: DemoScript = {
  title: "Cohort Pulse: the room's heartbeat",
  persona: 'demo-facilitator',
  scenes: [
    {
      id: 'hook',
      say: [
        'This is Cohort Pulse, a Fabric App in preview that shows a facilitator how well the room is following, live.',
        'Each light is one current answer, and the bands read lost, unsure and got it.',
      ],
      async run(h) {
        await h.goto('/', 'demo-facilitator');
        await h.page.getByTestId('heartbeat').waitFor();
        await h.pause(2500);
        await h.spotlight(h.page.getByTestId('gauge-lost'), 2000);
        await h.pause(1500);
      },
    },
    {
      id: 'read',
      say: [
        'Together the bands make one bar of the room, so lost can be read against the pause line at thirty percent.',
        'The pulse line beats faster as more of the room is lost, and nothing on this screen says who tapped what.',
      ],
      async run(h) {
        await h.spotlight(h.page.getByTestId('pause-line'), 2500);
        await h.spotlight(h.page.getByTestId('pulse-caption'), 3000);
        await h.pause(2000);
      },
    },
    {
      id: 'lenses',
      say: ['Lenses redraw the same totals: every module side by side, then the trend across the whole session.'],
      async run(h) {
        await h.click(h.page.getByRole('radio', { name: /All modules/ }));
        await h.pause(3000);
        await h.click(h.page.getByRole('radio', { name: /Trend/ }));
        await h.pause(3500);
      },
    },
    {
      id: 'today',
      say: [
        'Today ranks what needs me now, and picking an item focuses the room on it.',
        'Three people are active but have not answered this module yet.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: /have not answered yet/ }));
        await h.pause(3000);
        await h.click(h.page.getByRole('button', { name: /Most confusing so far/ }));
        await h.pause(2500);
      },
    },
    {
      id: 'check-in',
      say: [
        'Participants check in with a six-character code and get three big buttons.',
        'Sam taps Lost and asks for a worked example in a short note.',
      ],
      async run(h) {
        await h.goto('/', 'demo-sam');
        await h.type(h.page.getByLabel('Join code'), 'PULSE7');
        await h.click(h.page.getByRole('button', { name: 'Join', exact: true }));
        await h.page.getByTestId('current-module').waitFor();
        await h.type(h.page.getByLabel('Optional note for your facilitator'), 'Could you show a worked example?');
        await h.click(h.page.getByRole('button', { name: /^Lost/ }));
        await h.spotlight(h.page.getByTestId('you-said'), 2500);
      },
    },
    {
      id: 'pause',
      say: [
        "Back on the pulse, three of ten are lost, so the room's light warms and a calm prompt suggests a pause.",
        'The note arrives without a name.',
      ],
      async run(h) {
        await h.goto('/', 'demo-facilitator');
        await h.page.getByTestId('alert-moment').waitFor();
        await h.spotlight(h.page.getByTestId('alert-moment'), 3500);
        await h.click(h.page.getByRole('button', { name: /notes on this module/ }));
        await h.spotlight(h.page.getByTestId('notes-moment'), 3000);
      },
    },
    {
      id: 'room',
      say: ['When I share my screen, viewing as Room hides the notes and shows the join code instead.'],
      async run(h) {
        await h.page.keyboard.press('Escape');
        await h.click(h.page.getByRole('radio', { name: 'Room' }));
        await h.pause(3500);
        await h.click(h.page.getByRole('radio', { name: 'Facilitator' }));
      },
    },
    {
      id: 'next-module',
      say: ['Moving on starts the next module fresh, and every screen catches up within five seconds.'],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: /^Next module/ }));
        await h.spotlight(h.page.getByTestId('console-module'), 2500);
        await h.pause(1500);
      },
    },
    {
      id: 'report',
      say: [
        'After closing, the session report ranks modules by confusion; yesterday, Memory lost half the room.',
        'Copy as Markdown drops the whole report into a follow-up email.',
      ],
      async run(h) {
        await h.goto('/sessions', 'demo-facilitator');
        await h.click(h.page.getByRole('link', { name: `Session report for ${CLOSED}` }));
        await h.spotlight(h.page.getByTestId('confusion-ranking'), 3500);
        await h.scrollTo(h.page.getByText("The session's heartbeat"));
        await h.pause(2000);
        await h.hover(h.page.getByRole('button', { name: 'Copy as Markdown' }));
        await h.pause(1500);
      },
    },
    {
      id: 'takeaway',
      say: ['Cohort Pulse: know when the room is lost before anyone has to say so.'],
      async run(h) {
        await h.goto('/', 'demo-facilitator');
        await h.pause(3500);
      },
    },
  ],
};
