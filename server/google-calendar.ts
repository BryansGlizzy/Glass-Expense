import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import db from './db.js';
import { APP_URL } from './config.js';
import { serverCryptoAvailable, unwrapForServer, decryptCalendarTitleServer } from './server-crypto.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export const createOAuthClient = (): OAuth2Client => {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
};

export const getAuthorizedClient = async (userId: string): Promise<OAuth2Client | null> => {
  const user = db.prepare('SELECT google_refresh_token FROM users WHERE id = ?').get(userId) as any;
  if (!user || !user.google_refresh_token) return null;

  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({
    refresh_token: user.google_refresh_token
  });

  return oauth2Client;
};

type SyncResult = { success: boolean; skipped?: string; error?: string };

/**
 * Pushes a job to the user's Google Calendar. Job content is end-to-end encrypted, so this only works for
 * users who opted in to server-side sync (which hands the server their *calendar key*): the event contains
 * the job title and dates, never expenses, clients, notes or amounts.
 */
export const syncJobToGoogle = async (userId: string, jobId: string): Promise<SyncResult> => {
  const user = db.prepare('SELECT google_calendar_id, google_sync_jobs, server_calendar_key FROM users WHERE id = ?').get(userId) as any;
  if (!user || !user.google_sync_jobs) return { success: false, skipped: 'Sync disabled for user' };
  if (!user.server_calendar_key || !serverCryptoAvailable()) return { success: false, skipped: 'Server-side calendar sync is not enabled (job titles are encrypted)' };

  const job = db.prepare('SELECT id, start_date, end_date, google_event_id FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) return { success: false, skipped: 'Job not found' };
  if (!job.start_date) return { success: false, skipped: 'Job has no start_date. Cannot create calendar event without a date.' };

  const label = db.prepare('SELECT title_enc FROM job_calendar_labels WHERE job_id = ? AND user_id = ?').get(jobId, userId) as any;
  if (!label) return { success: false, skipped: 'No calendar label has been uploaded for this job' };

  let title: string;
  try {
    title = decryptCalendarTitleServer(unwrapForServer(user.server_calendar_key), jobId, label.title_enc);
  } catch {
    return { success: false, error: 'Could not decrypt the calendar title' };
  }

  const client = await getAuthorizedClient(userId);
  if (!client) return { success: false, skipped: 'Not authorized with Google' };

  const calendar = google.calendar({ version: 'v3', auth: client });
  const calendarId = user.google_calendar_id || 'primary';

  const event: any = {
    summary: `[GlassExpense] ${title}`,
    description: `Link: ${APP_URL}/jobs/${job.id}`,
    start: { date: job.start_date }, // All-day event
    end: { date: job.end_date || job.start_date },
  };

  try {
    if (job.google_event_id) {
      await calendar.events.update({ calendarId, eventId: job.google_event_id, requestBody: event });
    } else {
      const res = await calendar.events.insert({ calendarId, requestBody: event });
      if (res.data.id) {
        db.prepare('UPDATE jobs SET google_event_id = ? WHERE id = ?').run(res.data.id, jobId);
      }
    }
    return { success: true };
  } catch (error: any) {
    console.error('Error syncing job to Google Calendar:', error.message);
    return { success: false, error: error.message };
  }
};

export const deleteGoogleEvent = async (userId: string, eventId: string) => {
  const user = db.prepare('SELECT google_calendar_id FROM users WHERE id = ?').get(userId) as any;
  if (!user) return;

  const client = await getAuthorizedClient(userId);
  if (!client) return;

  const calendar = google.calendar({ version: 'v3', auth: client });
  const calendarId = user.google_calendar_id || 'primary';

  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (error: any) {
    // If the event is already deleted, just ignore it
    if (error.code !== 404 && error.code !== 410) {
      console.error('Error deleting Google Calendar event:', error);
    }
  }
};
