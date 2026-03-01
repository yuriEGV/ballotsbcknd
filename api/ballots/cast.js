import { castBallot } from '../../src/controllers/ballotController.js';
import allowCors from '../utils/serverlessHandler.js';

export default allowCors(castBallot);
