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

        const pkpHeader = req.headers["x-index-pkp-did-session"]
        if(pkpHeader){
            const pkpSession = await DIDSession.fromSession(pkpHeader);
            await pkpSession.did.authenticate()
            req.pkpDID = pkpSession.did;

            console.log("PKP DID Authenticated", req.pkpDID)
        }

        const personalHeader = req.headers["x-index-personal-did-session"]
        if(personalHeader){
            const personalSession = await DIDSession.fromSession(personalHeader);
            await personalSession.did.authenticate()
            req.personalDID = personalSession.did;

            console.log("Personal DID Authenticated", req.personalDID)
        }

    } catch (e){
        console.log("Authorization error");
    }

    next();
}


export const pkpMiddleware = (req, res, next) => {
    console.log(req.personalDID, req.pkpDID)
    if(!req.pkpDID){
        return res.status(401).send('Unauthorized');
    }
    next();
}

export const personalMiddleware = (req, res, next) => {
    console.log(req.personalDID, req.pkpDID)
    if(!req.personalDID){
        return res.status(401).send('Unauthorized');
    }
    next();
}
