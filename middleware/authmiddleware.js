import jwt from "jsonwebtoken";

export const authMiddleware = (req, res, next) => {
  try {
    console.log("====================================");
    console.log("🛡️ [authMiddleware] HIT");

    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      console.log("❌ No bearer token");
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const token = header.split(" ")[1];

    const secret = process.env.JWT_SECRET || process.env.SECRET_KEY;

    console.log("🎫 Token exists:", Boolean(token));
    console.log("🔐 Secret exists:", Boolean(secret));

    if (!secret) {
      return res.status(500).json({
        success: false,
        message: "JWT secret missing in backend env",
      });
    }

    const decoded = jwt.verify(token, secret);

    console.log("✅ Decoded token:", decoded);

    req.user = decoded.payLoad || decoded;

    console.log("✅ req.user set:", req.user);
    console.log("====================================");

    next();
  } catch (error) {
    console.error("❌ [authMiddleware] Invalid token:", error.message);

    return res.status(401).json({
      success: false,
      message: "Invalid token",
      error: error.message,
    });
  }
};

export const adminMiddleware = (req, res, next) => {
  authMiddleware(req, res, () => {
    if (req.user && req.user.role === "admin") {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  });
};

export const getAuthUserId = (req) => {
  if (!req.user) return null;
  return String(req.user._id || req.user.id || req.user.userId || '');
};

export const isOwnerOrAdmin = (req, resourceUserId) => {
  if (!req.user) return false;
  const authUserId = getAuthUserId(req);
  if (!authUserId) return false;
  if (req.user.role === 'admin') return true;
  return authUserId === String(resourceUserId || '');
};