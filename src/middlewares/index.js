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
        if(authHeader){
            const session = await DIDSession.fromSession(authHeader.split(' ')[1]);
            await session.did.authenticate()
            req.user = session.did;

            console.log("Authenticated", req.user)
        }

    } catch (e){
        console.log("Public");
    }

    next();
}

export const privateRouteMiddleware = (req, res, next) => {
    if(!req.user){
        return res.status(401).send('Unauthorized');
    }
    next();
}
