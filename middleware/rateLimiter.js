import rateLimit from 'express-rate-limit';

// Standardized error response handler for HTTP 429 Too Many Requests
const rateLimitHandler = (req, res, next, options) => {
  const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
  res.setHeader('Retry-After', retryAfterSeconds);
  res.status(options.statusCode || 429).json({
    success: false,
    error: options.message?.error || 'Too many requests from this IP. Please try again later.',
    message: options.message?.error || 'Too many requests from this IP. Please try again later.',
    retryAfterSeconds,
  });
};

// 1. Strict Authentication Rate Limiter (Login, Google OAuth Login, 2FA Verification)
// Limit: 10 requests per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  message: {
    error: 'Too many login attempts from this IP. Please try again after 15 minutes.',
  },
});

// 2. Extra Strict Rate Limiter for Sensitive Auth Operations (Signup, Password Reset, Set Password, Magic Link)
// Limit: 5 requests per 15 minutes per IP
export const sensitiveAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  message: {
    error: 'Too many requests for sensitive operations. Please try again after 15 minutes.',
  },
});

// 3. Rate Limiter for Public Forms (Talk To Sales / Contact)
// Limit: 5 requests per 15 minutes per IP
export const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  message: {
    error: 'Too many form submissions from this IP. Please try again after 15 minutes.',
  },
});

// 4. General API Rate Limiter (Applied to general user API endpoints)
// Limit: 200 requests per 15 minutes per IP
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  message: {
    error: 'Too many API requests. Please slow down.',
  },
});
