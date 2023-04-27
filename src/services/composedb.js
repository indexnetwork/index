import * as composedb from '../libs/composedb.js';

export const get_index = async (req, res, next) => {

    const { id } = req.params;

    const index = await composedb.getIndexById(id)
    if(!index){
        return res.status(404).end();
    }
    return res.json(index);
};


export const get_index_link = async (req, res, next) => {

    const { id } = req.params;

    const index = await composedb.getIndexLinkById(id)
    if(!index){
        return res.status(404).end();
    }
    return res.json(index);
};

