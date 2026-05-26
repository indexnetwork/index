import { describe, it, expect, afterAll } from 'bun:test';
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import {
    sendConnectionRequestEmail,
    sendConnectionAcceptedEmail,

} from '../notification.sender';

// Only run this if explicitly requested or if we have the API key
const runIntegration = process.env.RESEND_API_KEY && process.env.TESTING_EMAIL_ADDRESS;

describe.skipIf(!runIntegration)('Email Handlers Integration (Real Emails)', () => {
    const testEmail = process.env.TESTING_EMAIL_ADDRESS || 'test@example.com';

    // Helper to wait
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    it('should send a real connection request email', async () => {
        console.log(`Sending real connection request email to ${testEmail}...`);
        await sendConnectionRequestEmail(
            testEmail,
            'Alice Integration',
            'Bob Integration',
            '<p>This is a <strong>real</strong> integration test email for connection request.</p>',
            'Integration Test: Connection Request'
        );
        // If no error is thrown, we assume success (Resend SDK throws on failure)
        expect(true).toBe(true);
        await wait(1000); // Rate limit buffer
    });

    it('should send a real connection accepted email', async () => {
        console.log(`Sending real connection accepted email to ${testEmail}...`);
        await sendConnectionAcceptedEmail(
            [testEmail],
            'Alice Integration',
            'Bob Integration',
            '<p>This is a <strong>real</strong> integration test email for connection accepted.</p>'
        );
        expect(true).toBe(true);
        await wait(1000); // Rate limit buffer
    });




});
