import { createElection } from '../../src/controllers/electionController.js';
import allowCors from '../utils/serverlessHandler.js';

export default allowCors(createElection);
