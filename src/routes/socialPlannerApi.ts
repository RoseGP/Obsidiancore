import { Router, Request, Response } from 'express';
import socialPostsRouter from './socialPosts';

const router = Router();

// Re-export / forward standard social post routes
router.use('/', socialPostsRouter);

// Specific planner schedule & calendar endpoints
router.get('/calendar', async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        events: [],
        upcomingCount: 0
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal error' });
  }
});

router.get('/analytics', async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      analytics: {
        totalScheduled: 12,
        totalPublished: 48,
        engagementRate: '4.8%',
        audienceReach: 15420
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal error' });
  }
});

export default router;
