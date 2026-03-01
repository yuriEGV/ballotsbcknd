import { logout } from '../../src/controllers/authController.js';
import allowCors from '../utils/serverlessHandler.js';

export default allowCors(logout);
