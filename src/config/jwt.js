export const getJwtSecret = () => {
    if (process.env.JWT_SECRET) {
        return process.env.JWT_SECRET;
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("JWT_SECRET must be configured in production");
    }
    return "dev_only_jwt_secret_change_in_production";
};

export const getBallotHmacSecret = () => {
    if (process.env.BALLOT_HMAC_SECRET) {
        return process.env.BALLOT_HMAC_SECRET;
    }
    if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
        throw new Error("BALLOT_HMAC_SECRET must be configured in production");
    }
    return `${getJwtSecret()}::ballot-hmac-v1`;
};

