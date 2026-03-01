import express from 'express';
import { getUsers, updateUser, deleteUser } from '../controllers/userController.js';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require Admin role
router.use(requireAuth);
router.use(requireAdmin);

router.get('/', getUsers);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
