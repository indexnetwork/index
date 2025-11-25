import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import axios from 'axios';
import { uploadBase64ImageToS3 } from '../lib/s3';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';

const router = Router();

// Submit feedback
router.post('/',
  authenticatePrivy,
  [
    body('feedback').trim().isLength({ max: 5000 }),
    body('image').optional().isString(),
  ],
  async (req: AuthRequest, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { feedback, image } = req.body;

      if (!feedback && !image) {
        return res.status(400).json({ error: 'Feedback or image is required' });
      }

      // Log to console use message with emoji
      console.log(`📝 New feedback received`);
      
      const slackWebhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
      if (slackWebhookUrl) {
        // Upload image to S3 if present and webhook is configured
        let imageUrl: string | undefined;
        if (image) {
          try {
            imageUrl = await uploadBase64ImageToS3(image);
            console.log('Uploaded image URL:', imageUrl);
          } catch (uploadError) {
            console.error('Failed to upload image to S3:', uploadError);
          }
        }
        try {
          const slackMessage = {
            text: `📝 *New Feedback Received*`,
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: '📝 New Feedback Received',
                  emoji: true
                }
              },
              {
                type: 'section',
                fields: [
                  {
                    type: 'mrkdwn',
                    text: `*User ID:*\n${req.user!.id}`
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Time:*\n${new Date().toLocaleString()}`
                  }
                ]
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Feedback:*\n${feedback || '_No text provided_'}`
                }
              }
            ]
          };

          if (image) {
            if (imageUrl) {
              // Add image block to Slack message
              (slackMessage.blocks as any[]).push({
                type: 'image',
                image_url: imageUrl,
                alt_text: 'Feedback Image'
              });
            } else {
              // Fallback to text note if upload failed
              (slackMessage.blocks as any[]).push({
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: '📸 _Image attached (Upload failed)_'
                  }
                ]
              });
            }
          }

          await axios.post(slackWebhookUrl, slackMessage, { timeout: 5000 });
          console.log('Feedback sent to Slack');
        } catch (slackError) {
          console.error('Failed to send feedback to Slack:', slackError);
          // Don't fail the request if Slack fails
        }
      } else {
        console.warn('SLACK_FEEDBACK_WEBHOOK_URL not configured, skipping Slack notification');
      }

      return res.json({ success: true });
    } catch (error) {
      console.error('Submit feedback error:', error);
      return res.status(500).json({ error: 'Failed to submit feedback' });
    }
  }
);

export default router;
