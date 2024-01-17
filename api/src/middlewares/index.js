import {DIDSession} from "did-session";


export const errorMiddleware = (err, req, res, next) => {
    if (err && err.error && err.error.isJoi) {
        res.status(400).json({
            type: err.type,
            message: err.error.toString()
        });
    } else {
        next(err);
    }
}

export const authenticateMiddleware = async (req, res, next) => {
    try{

        const authHeader = req.headers.authorization;

        // Check if the Authorization header is present
        if (!authHeader) {
            // Authorization header is missing
            return next()
        }

        // Split the Authorization header to extract the token
        const parts = authHeader.split(' ');

        // Check if the header has the correct format ('Bearer TOKEN')
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return next()
        }

        // Extract the token
        const token = parts[1];

        if(token){
            const session = await DIDSession.fromSession(token);
            await session.did.authenticate()

            req.session = session;

            console.log("Session Authenticated", req.session.did.parent);
        }

    } catch (e){
        console.log("Authorization error", e);
    }

    next();
}

export const authCheckMiddleware = (req, res, next) => {
    if(!req.session || !req.session.did.authenticated){
        return res.status(401).send({
            error: "Authorization error"
        });

    }
    next();
}
