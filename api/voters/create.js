import { createVoter } from '../../src/controllers/voterController.js';
import allowCors from '../utils/serverlessHandler.js';

export default allowCors(createVoter);
