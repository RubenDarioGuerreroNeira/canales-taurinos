import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
    ChatSession,
} from '@google/generative-ai';

@Injectable()
export class GeminiService {
    private genAI: GoogleGenerativeAI;
    private readonly logger = new Logger(GeminiService.name);

    constructor(private configService: ConfigService) {
        const apiKey = this.configService.get<string>('GOOGLE_API_KEY');
        if (!apiKey) {
            throw new Error('GOOGLE_API_KEY is not defined in environment variables');
        }
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    createChatSession(): ChatSession {
        const model = this.genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE,
                },
            ],
        });

        return model.startChat({
            history: [],
            generationConfig: { maxOutputTokens: 1000 },
        });
    }
}
