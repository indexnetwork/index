const composedb = require('../libs/composedb.js');

exports.get_index = async (req, res, next) => {

    const { id } = req.params;

    const index = await composedb.getIndexById(id)
    if(!index){
        return res.status(404).end();
    }
    return res.json(index);
};


exports.get_index_link = async (req, res, next) => {

    const { id } = req.params;

    const index = await composedb.getIndexLinkById(id)
    if(!index){
        return res.status(404).end();
    }
    return res.json(index);
};

