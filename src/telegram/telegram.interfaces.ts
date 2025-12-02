import { Scenes } from 'telegraf';
import { ChatSession } from '@google/generative-ai';
import { ServitoroEvent } from '../scraper/servitoro.service';
import { EscalafonEntry } from '../scraper/interfaces/torero.interface';

export interface MySceneSession extends Scenes.SceneSessionData {
  filterState?: 'awaiting_month' | 'awaiting_channel';
  filterStateCal?:
    | 'awaiting_month_cal'
    | 'awaiting_city_cal'
    | 'awaiting_location_cal'
    | 'awaiting_free_text_cal';
  servitoroEvents?: ServitoroEvent[];
  currentCalFilter?: {
    type: 'month' | 'city' | 'location' | 'free';
    value: string;
  };
  currentCalPage?: number;
  escalafonData?: EscalafonEntry[];
  currentPage?: number;
  americaSearchTerm?: string;
}

export interface MySession extends Scenes.SceneSession<MySceneSession> {
  geminiChat?: ChatSession;
}

export interface MyContext extends Scenes.SceneContext<MySceneSession> {
  session: MySession;
  match?: RegExpExecArray;
}
