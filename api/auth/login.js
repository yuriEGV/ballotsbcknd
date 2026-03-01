import { login } from '../../src/controllers/authController.js';
import allowCors from '../utils/serverlessHandler.js';

export default allowCors(login);
