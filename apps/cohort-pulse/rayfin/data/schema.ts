import { AppMarker } from './AppMarker.js';
import { CheckIn } from './CheckIn.js';
import { Person } from './Person.js';
import { PulseJoin } from './PulseJoin.js';
import { PulseModule } from './PulseModule.js';
import { PulseSession } from './PulseSession.js';

export type AppSchema = {
  Person: Person;
  AppMarker: AppMarker;
  PulseSession: PulseSession;
  PulseModule: PulseModule;
  CheckIn: CheckIn;
  PulseJoin: PulseJoin;
};

export const schema = [Person, AppMarker, PulseSession, PulseModule, CheckIn, PulseJoin];
