import { MonksTokenBar, log, i18n } from "../monks-tokenbar.js";

export class SavingThrowApp extends Application {
    constructor(tokens, options) {
        super(options);

        if (tokens != undefined && !$.isArray(tokens))
            tokens = [tokens];
        this.tokens = (tokens || canvas.tokens.controlled.filter(t => t.actor != undefined));

        if (this.tokens.length == 0) {   //if none have been selected then default to the party
            this.tokens = canvas.tokens.placeables.filter(t => {
                return t.actor != undefined && t.actor?.hasPlayerOwner && t.actor?.data.type != 'npc';
            });
        }
        this.rollmode = (options?.rollmode || game.user.getFlag("monks-tokenbar", "lastmodeST") || 'roll');
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "requestsavingthrow",
            title: i18n("MonksTokenBar.RequestRoll"),
            template: "./modules/monks-tokenbar/templates/savingthrow.html",
            width: 400,
            height: 400,
            popOut: true
        });
    }

    getData(options) {

        return {
            tokens: this.tokens,
            select: this.select,
            request: this.request,
            rollmode: this.rollmode,
            options: MonksTokenBar.requestoptions
        };
    }

    addToken(tokens) {
        if (!$.isArray(tokens))
            tokens = [tokens];
        for (let token of tokens) {
            if (this.tokens.find(t => t.id === token.id) == undefined) {
                if (token.actor == undefined)
                    ui.notifications.warn(i18n("MonksTokenBar.TokenNoActorAttrs"));
                else
                    this.tokens.push(token);
            }
        }
        this.render(true);
    }
    changeTokens(e) {
        let type = e.target.dataset.type;
        switch (type) {
            case 'player':
                this.tokens = canvas.tokens.placeables.filter(t => {
                    return t.actor != undefined && t.actor?.hasPlayerOwner && t.actor?.data.type != 'npc';
                });
                this.render(true);
                break;
            case 'monster':
                this.tokens = canvas.tokens.placeables.filter(t => {
                    return t.actor != undefined && t.visible && !t.actor?.hasPlayerOwner;
                });
                this.render(true);
                break;
            case 'actor': //toggle the select actor button
                let tokens = canvas.tokens.controlled.filter(t => t.actor != undefined);
                MonksTokenBar.tokenbar.savingthrow.addToken(tokens);
                break;
            case 'clear':
                this.tokens = [];
                this.render(true);
                break;
        }
    }

    removeToken(id) {
        let idx = this.tokens.findIndex(t => t.id === id);
        if (idx > -1) {
            this.tokens.splice(idx, 1);
        }
        this.render(true);
    }

    async requestRoll() {
        if (this.tokens.length > 0) {
            let tokens = this.tokens.map(t => {
                return {
                    id: t.id,
                    actorid: t.actor.id,
                    icon: (t.data.img.endsWith('webm') ? t.actor.data.img : t.data.img),
                    name: t.name
                };
            });
            let parts = $('#savingthrow-request', this.element).val().split(':');
            let requesttype = (parts.length > 1 ? parts[0] : '');
            let request = (parts.length > 1 ? parts[1] : parts[0]);
            let rollmode = $('#savingthrow-rollmode', this.element).val();
            game.user.setFlag("monks-tokenbar", "lastmodeST", rollmode);
            let modename = (rollmode == 'roll' ? i18n("MonksTokenBar.PublicRoll") : (rollmode == 'gmroll' ? i18n("MonksTokenBar.PrivateGMRoll") : (rollmode == 'blindroll' ? i18n("MonksTokenBar.BlindGMRoll") : i18n("MonksTokenBar.SelfRoll"))));

            let requestdata = {
                dc: $('#monks-tokenbar-savingdc', this.element).val() || (request == 'death' ? '10' : ''),
                name: $('#savingthrow-request option:selected', this.element).html() + " " + (requesttype == 'ability' ? i18n("MonksTokenBar.AbilityCheck") : (requesttype == 'saving' ? i18n("MonksTokenBar.SavingThrow") : i18n("MonksTokenBar.Check"))),
                requesttype: requesttype,
                request: request,
                rollmode: rollmode,
                modename: modename,
                tokens: tokens
            };
            const html = await renderTemplate("./modules/monks-tokenbar/templates/svgthrowchatmsg.html", requestdata);
            delete requestdata.tokens;
            for (let i = 0; i < tokens.length; i++)
                requestdata["token" + tokens[i].id] = tokens[i];

            log('create chat request');
            let chatData = {
                user: game.user._id,
                content: html
            };
            if (requestdata.rollmode == 'selfroll')
                chatData.whisper = [game.user._id];
            else if (requestdata.rollmode == 'blindroll') {
                chatData.whisper = [game.user._id];
                for (let i = 0; i < this.tokens.length; i++) {
                    let token = this.tokens[i];
                    if (token.actor != undefined) {
                        for (var key in token.actor.data.permission) {
                            if (key != 'default' && token.actor.data.permission[key] >= CONST.ENTITY_PERMISSIONS.OWNER) {
                                if (chatData.whisper.find(t => t == key) == undefined)
                                    chatData.whisper.push(key);
                            }
                        }
                    }
                }
            }
            //chatData.flags["monks-tokenbar"] = {"testmsg":"testing"};
            setProperty(chatData, "flags.monks-tokenbar", requestdata);
            ChatMessage.create(chatData, {});
            this.close();
        } else
            ui.notifications.warn(i18n("MonksTokenBar.RequestNoneTokenSelected"));
    }

    activateListeners(html) {
        super.activateListeners(html);
        var that = this;

        $('.items-header .item-controls', html).click($.proxy(this.changeTokens, this));

        $('.item-list .item', html).each(function (elem) {
            $('.item-delete', this).click($.proxy(that.removeToken, that, this.dataset.itemId));
        });

        $('.dialog-buttons.request', html).click($.proxy(this.requestRoll, this));

        $('#savingthrow-request', html).change($.proxy(function (e) {
            this.request = $(e.currentTarget).val();
        }, this));
        $('#savingthrow-rollmode', html).change($.proxy(function (e) {
            this.rollmode = $(e.currentTarget).val();
        }, this));
    };
}

export class SavingThrow {
    static msgcontent = {};

    static _rollAbility(item, request, requesttype, rollmode, fastForward, e) {
        let returnRoll = function (roll) {
            log("Roll", roll, actor);
            if (roll != undefined) {
                let finishroll;
                if (game.dice3d != undefined && roll instanceof Roll) {// && !fastForward) {
                    let whisper = (rollmode == 'roll' ? null : ChatMessage.getWhisperRecipients("GM").map(w => { return w.id }));
                    if (rollmode == 'gmroll' && !game.user.isGM)
                        whisper.push(game.user._id);
                    const sound = MonksTokenBar.getDiceSound();
                    if (sound != undefined)
                        AudioHelper.play({ src: sound });

                    setTimeout(() => {
                        //just confirm that the roll has finished.  Mass rolls aren't saving properly.
                        //SavingThrow.finishRolling(item, message);
                    }, 3000);

                    finishroll = game.dice3d.showForRoll(roll, game.user, true, whisper, (rollmode == 'blindroll' && !game.user.isGM)).then(() => {
                        return { id: item.id, reveal: true, userid: game.userId };
                    });
                }

                return { id: item.id, roll: roll, finish: finishroll };
            }
        }

        let actor = game.actors.get(item.actorid);

        if (actor != undefined) {
            if (game.system.id == 'dnd5e') {
                let rollfn = null;
                if (requesttype == 'ability') {
                    rollfn = (actor.getFunction ? actor.getFunction("rollAbilityTest") : actor.rollAbilityTest);
                }
                else if (requesttype == 'saving') {
                    rollfn = actor.rollAbilitySave;
                }
                else if (requesttype == 'skill') {
                    rollfn = actor.rollSkill;
                } else {
                    if (request == 'death')
                        rollfn = SavingThrow.rollDeathSave;
                }

                if (rollfn != undefined) {
                    return rollfn.call(actor, request, { fastForward: fastForward, chatMessage: false, fromMars5eChatCard: true }).then((roll) => { return returnRoll(roll); });
                } else
                    ui.notifications.warn(actor.name + ' ' + i18n("MonksTokenBar.ActorNoRollFunction"));
            } else if (game.system.id == 'pf2e') {
                let rollfn = null;
                let opts = request;
                if (requesttype == 'attribute') {
                    if (actor.data.data.attributes[request]?.roll) {
                        opts = actor.getRollOptions(["all", request]);
                        rollfn = actor.data.data.attributes[request].roll;
                    } else
                        rollfn = actor.rollAttribute;
                }
                else if (requesttype == 'ability') {
                    rollfn = function (event, abilityName) {
                        const skl = this.data.data.abilities[abilityName],
                            flavor = `${CONFIG.PF2E.abilities[abilityName]} Check`;
                        return DicePF2e.d20Roll({
                            event: event,
                            parts: ["@mod"],
                            data: {
                                mod: skl.mod
                            },
                            title: flavor,
                            speaker: ChatMessage.getSpeaker({
                                actor: this
                            }),
                            rollType: 'ignore'
                        });
                    }
                }
                else if (requesttype == 'saving') {
                    if (actor.data.data.saves[request]?.roll) {
                        opts = actor.getRollOptions(["all", "saving-throw", request]);
                        rollfn = actor.data.data.saves[request].roll;
                    } else 
                        rollfn = actor.rollSave;
                }
                else if (requesttype == 'skill') {
                    if (actor.data.data.skills[request]?.roll) {
                        opts = actor.getRollOptions(["all", "skill-check", request]);
                        rollfn = actor.data.data.skills[request].roll;
                    } else
                        rollfn = actor.rollSkill;
                }

                if (rollfn != undefined) {
                    if (requesttype == 'ability')
                        return rollfn.call(actor, e, opts).then((roll) => { return returnRoll(roll); });
                    else {
                        opts.push("ignore");
                        return new Promise(function (resolve, reject) {
                            rollfn.call(actor, e, opts, function (roll) { resolve(returnRoll(roll)); });
                        });
                    }
                } else
                    ui.notifications.warn(actor.name + i18n("MonksTokenBar.ActorNoRollFunction"));
            } else
                ui.notifications.warn(actor.name + ' ' + i18n("MonksTokenBar.ActorNoRollFunction"));
        }
    }

    static async rollDeathSave() {
        let r = new Roll("1d20");
        r.evaluate();
        return r;
    }

    static async onRollAbility(ids, message, fastForward = false, e) {
        if (ids == undefined) return;
        if (!$.isArray(ids))
            ids = [ids];

        let flags = message.data.flags['monks-tokenbar'];

        let request = message.getFlag('monks-tokenbar', 'request');
        let requesttype = message.getFlag('monks-tokenbar', 'requesttype');
        let rollmode = message.getFlag('monks-tokenbar', 'rollmode');

        let promises = [];
        for (let id of ids) {
            let msgtoken = flags["token" + id];
            if (msgtoken != undefined && msgtoken.roll == undefined) {
                let actor = game.actors.get(msgtoken.actorid);
                if (actor != undefined) {
                    //roll the dice, using standard details from actor
                    promises.push(SavingThrow._rollAbility({ id: id, actorid: msgtoken.actorid }, request, requesttype, rollmode, fastForward, e));
                }
            }
        };

        Promise.all(promises).then(response => {
            log('roll all finished', response);
            if (!game.user.isGM) {
                let responses = response.map(r => { return { id: r.id, roll: r.roll }; });
                game.socket.emit(
                    MonksTokenBar.SOCKET,
                    {
                        msgtype: 'rollability',
                        type: 'savingthrow',
                        senderId: game.user._id,
                        msgid: message.id,
                        response: responses
                    },
                    (resp) => { }
                );

                let promises = response.filter(r => r.finish != undefined).map(r => { return r.finish; });
                if (promises.length) {
                    Promise.all(promises).then(response => {
                        SavingThrow.finishRolling(response, message);
                    });
                }
            } else {
                const revealDice = game.dice3d ? game.settings.get("dice-so-nice", "immediatelyDisplayChatMessages") : true;
                SavingThrow.updateMessage(response, message, revealDice);
            }
        });
        
    }

    static async updateMessage(updates, message, reveal = true) {
        if (updates == undefined) return;

        let dc = message.getFlag('monks-tokenbar', 'dc');
        let content = $(message.data.content);

        let flags = {};

        let promises = [];

        for (let update of updates) {
            if (update != undefined) {
                let msgtoken = duplicate(message.getFlag('monks-tokenbar', 'token' + update.id));
                log('updating actor', msgtoken, update.roll);

                msgtoken.roll = update.roll.toJSON();
                msgtoken.reveal = reveal;
                msgtoken.total = update.roll.total;

                let tooltip = await update.roll.getTooltip();

                if (dc != '')
                    msgtoken.passed = (msgtoken.total >= dc);


                if ($('.item[data-item-id="' + update.id + '"] .item-row .dice-tooltip', content).length == 0)
                    $(tooltip).hide().insertAfter($('.item[data-item-id="' + update.id + '"] .item-row', content));
                $('.item[data-item-id="' + update.id + '"] .item-row .item-roll', content).remove();
                if ($('.item[data-item-id="' + update.id + '"] .item-row .roll-controls .dice-total', content).length == 0) {
                    $('.item[data-item-id="' + update.id + '"] .item-row .roll-controls', content).append(
                        `<div class="dice-total flexrow" style="display:none;">
                <div class="dice-result">${msgtoken.total}</div >
                <a class="item-control result-passed gm-only" title="${i18n("MonksTokenBar.RollPassed")}" data-control="rollPassed">
                    <i class="fas fa-check"></i>
                </a>
                <a class="item-control result-failed gm-only" title="${i18n("MonksTokenBar.RollFailed")}" data-control="rollFailed">
                    <i class="fas fa-times"></i>
                </a>
                <div class="dice-text player-only"></div>
            </div >`);
                }
                flags["token" + update.id] = msgtoken;
                //await message.setFlag('monks-tokenbar', 'token' + update.id, msgtoken);

                if (update.finish != undefined)
                    promises.push(update.finish);
            }
        }

        message.update({ content: content[0].outerHTML, flags: { 'monks-tokenbar': flags } });

        if (promises.length) {
            Promise.all(promises).then(response => {
                log('rolls revealed', response);
                SavingThrow.finishRolling(response, message);
            });
        }
    }

    static async finishRolling(updates, message) {
        if (updates.length == 0) return;

        if (!game.user.isGM) {
            let response = updates.filter(r => { return r.userid == game.userId; });
            if (response.length) {
                game.socket.emit(
                    MonksTokenBar.SOCKET,
                    {
                        msgtype: 'finishroll',
                        type: 'savingthrow',
                        senderId: game.user._id,
                        response: response,
                        msgid: message.id
                    }
                );
            }
        } else {
            let flags = {};
            for (let update of updates) {
                let msgtoken = duplicate(message.getFlag('monks-tokenbar', 'token' + update.id));
                msgtoken.reveal = true;
                flags["token" + update.id] = msgtoken;
                log("Finish Rolling", msgtoken);
            }
            message.update({ flags: { 'monks-tokenbar': flags } });
        }
    }

    /*
    static async updateSavingRoll(actorid, message, roll, reveal = true) {
        let dc = message.getFlag('monks-tokenbar', 'dc');

        //let actors = JSON.parse(JSON.stringify(message.getFlag('monks-tokenbar', 'actors')));
        let msgactor = duplicate(message.getFlag('monks-tokenbar', 'actor' + actorid)); //actors.find(a => { return a.id == actorid; });
        log('updating actor', msgactor, roll);

        msgactor.roll = roll.toJSON();
        msgactor.reveal = reveal;//!fastForward;
        msgactor.total = roll.total;

        let tooltip = await roll.getTooltip();

        if (dc != '')
            msgactor.passed = (msgactor.total >= dc);

        let content = SavingThrow.msgcontent[message.id];
        if (content == undefined)
            content = SavingThrow.msgcontent[message.id] = $(message.data.content);

        if ($('.item[data-item-id="' + actorid + '"] .item-row .dice-tooltip', content).length == 0)
            $(tooltip).insertAfter($('.item[data-item-id="' + actorid + '"] .item-row', content));
        $('.item[data-item-id="' + actorid + '"] .item-row .item-roll', content).remove();
        if ($('.item[data-item-id="' + actorid + '"] .item-row .roll-controls .dice-total', content).length == 0) {
            $('.item[data-item-id="' + actorid + '"] .item-row .roll-controls', content).append(
            `<div class="dice-total flexrow" style="display:none;">
                <div class= "dice-result">${msgactor.total}</div >
                <a class="item-control result-passed gm-only" title="Roll Passed" data-control="rollPassed">
                    <i class="fas fa-check"></i>
                </a>
                <a class="item-control result-failed gm-only" title="Roll Failed" data-control="rollFailed">
                    <i class="fas fa-times"></i>
                </a>
                <div class="dice-text player-only"></div>
            </div >`);
        }

        message.update({ content: content[0].outerHTML });
        delete SavingThrow.msgcontent[message.id];

        await message.setFlag('monks-tokenbar', 'actor' + actorid, msgactor); //message.setFlag('monks-tokenbar', 'actors', actors);
    }*/

    static async onRollAll(tokentype, message, e) {
        if (game.user.isGM) {
            let flags = message.data.flags['monks-tokenbar'];
            let tokens = Object.keys(flags)
                .filter(key => key.startsWith('token'))
                .map(key => flags[key]);

            let ids = tokens.filter(t => {
                if (t.roll != undefined) return false;
                let actor = game.actors.get(t.actorid);
                return (actor != undefined && (tokentype == 'all' || actor.data.type != 'character'));
            }).map(a => a.id);

            SavingThrow.onRollAbility(ids, message, true, e);

            /*
            for (let msgactor of actors) {
                if (msgactor.roll == undefined) {
                    let actor = game.actors.get(msgactor.id);
                    if (actor != undefined && (mode == 'all' || actor.data.type != 'character')) {
                        //roll the dice, using standard details from actor
                        SavingThrow.onRollAbility(msgactor.id, message, true);
                    }
                }
            };*/
        }
    }

    static async setRollSuccess(tokenid, message, success) {
        //let actors = JSON.parse(JSON.stringify(message.getFlag('monks-tokenbar', 'actors')));
        let msgtoken = duplicate(message.getFlag('monks-tokenbar', 'token' + tokenid)); //actors.find(a => { return a.id == actorid; });

        if (msgtoken.passed === success)
            delete msgtoken.passed;
        else
            msgtoken.passed = success;

        await message.setFlag('monks-tokenbar', 'token' + tokenid, msgtoken);
    }

    static async _onClickToken(tokenId, event) {
        if (event.stopPropagation) event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        event.cancelBubble = true;
        event.returnValue = false;

        let token = canvas.tokens.get(tokenId);
        token.control({ releaseOthers: true });
        return canvas.animatePan({ x: token.x, y: token.y });
    }
}

/*
Hooks.on("diceSoNiceRollComplete", (messageid) => {
    let message = ui.messages.find(m => m.id == messageid);
    if (message != undefined) {
        if()
    }
})*/

Hooks.on("renderSavingThrowApp", (app, html) => {
    if (app.request == undefined) {
        //if all the tokens are players, then default to perception
        let allPlayers = (app.tokens.filter(t => t.actor?.hasPlayerOwner).length == app.tokens.length);
        //if all the tokens have zero hp, then default to death saving throw
        let allZeroHP = app.tokens.filter(t => t.actor?.data.data.attributes.hp.value == 0).length;
        $('#savingthrow-request', html).val(allZeroHP == app.tokens.length && allZeroHP != 0 && game.system.id == "dnd5e" ? 'death' : (allPlayers ? (game.system.id == "dnd5e" ? 'skill:prc' : 'attribute:perception' ) : $('#savingthrow-request option:first', html).val()));
    } else
        $('#savingthrow-request', html).val(app.request);

    $('.items-header .item-control[data-type="actor"]', html).toggleClass('selected', app.selected === true);
    $('#savingthrow-rollmode', html).val(app.rollmode);

    $('.item-control[data-type="monster"]', html).hide();
});

Hooks.on("renderChatMessage", (message, html, data) => {
    const svgCard = html.find(".monks-tokenbar.savingthrow");
    if (svgCard.length !== 0) {
        log('Rendering chat message', message);
        if (!game.user.isGM)
            html.find(".gm-only").remove();
        if (game.user.isGM)
            html.find(".player-only").remove();

        let dc = message.getFlag('monks-tokenbar', 'dc');
        let rollmode = message.getFlag('monks-tokenbar', 'rollmode');

        $('.roll-all', html).click($.proxy(SavingThrow.onRollAll, SavingThrow, 'all', message));
        $('.roll-npc', html).click($.proxy(SavingThrow.onRollAll, SavingThrow, 'npc', message));

        //let actors = message.getFlag('monks-tokenbar', 'actors');

        let items = $('.item', html);
        let count = 0;
        let groupdc = 0;
        for (let i = 0; i < items.length; i++) {
            var item = items[i];
            let tokenId = $(item).attr('data-item-id');
            let msgtoken = message.getFlag('monks-tokenbar', 'token' + tokenId);//actors.find(a => { return a.id == actorId; });
            if (msgtoken) {
                let actor = game.actors.get(msgtoken.actorid);

                $(item).toggle(game.user.isGM || rollmode == 'roll' || rollmode == 'gmroll' || (rollmode == 'blindroll' && actor.owner));

                if (game.user.isGM || actor.owner)
                    $('.item-image', item).on('click', $.proxy(SavingThrow._onClickToken, this, msgtoken.id))
                $('.item-roll', item).toggle(msgtoken.roll == undefined && (game.user.isGM || (actor.owner && rollmode != 'selfroll'))).click($.proxy(SavingThrow.onRollAbility, this, msgtoken.id, message, false));
                $('.dice-total', item).toggle(msgtoken.roll != undefined && (game.user.isGM || rollmode == 'roll' || (actor.owner && rollmode != 'selfroll')));
                if (msgtoken.roll != undefined && msgtoken.roll.class == "Roll") {
                    //log('Chat roll:', msgtoken.roll);
                    let roll = Roll.fromData(msgtoken.roll);
                    let showroll = game.user.isGM || rollmode == 'roll' || (rollmode == 'gmroll' && actor.owner);
                    $('.dice-result', item).toggle(showroll || (rollmode == 'blindroll' && actor.owner));
                    if (!msgtoken.reveal || (rollmode == 'blindroll' && !game.user.isGM)) {
                        $('.dice-result', item).html(!msgtoken.reveal ? '...' : '-');
                    } else {
                        $('.dice-result', item)
                            .toggleClass('success', roll.dice[0].total >= roll.dice[0].options.critical)
                            .toggleClass('fail', roll.dice[0].total <= roll.dice[0].options.fumble);
                    }
                    if (!msgtoken.reveal && game.user.isGM)
                        $('.dice-result', item).on('click', $.proxy(SavingThrow.finishRolling, SavingThrow, [msgtoken.id], message));
                    //if (showroll && msgactor.reveal && $('.dice-tooltip', item).is(':empty')) {
                    //    let tooltip = await roll.getTooltip();
                    //    $('.dice-tooltip', item).empty().append(tooltip);
                    //}
                    $('.dice-tooltip', item).toggleClass('noshow', !showroll);
                    $('.result-passed', item).toggleClass('recommended', dc != '' && roll.total >= dc).toggleClass('selected', msgtoken.passed === true).click($.proxy(SavingThrow.setRollSuccess, this, msgtoken.id, message, true));
                    $('.result-failed', item).toggleClass('recommended', dc != '' && roll.total < dc).toggleClass('selected', msgtoken.passed === false).click($.proxy(SavingThrow.setRollSuccess, this, msgtoken.id, message, false));

                    $('.dice-text', item).toggle(showroll && msgtoken.passed != undefined).toggleClass('passed', msgtoken.passed === true).toggleClass('failed', msgtoken.passed === false).html(msgtoken.passed === true ? i18n("MonksTokenBar.Passed") : msgtoken.passed === false ? i18n("MonksTokenBar.Failed") : '');

                    count++;
                    groupdc += roll.total;
                }
            }

            //if there hasn't been a roll, then show the button if this is the GM or if this token is controlled by the current user

            //if this is the GM, and there's a roll, show the pass/fail buttons
            //highlight a button if the token hasn't had a result selected
            //toggle the button, if a result has been selected

            //if this is not the GM, and the results should be shown, and a result has been selected, then show the result
        };

        //calculate the group DC
        if (count > 0)
            $('.group-dc', html).html(parseInt(groupdc / count));

        //let modename = (rollmode == 'roll' ? 'Public Roll' : (rollmode == 'gmroll' ? 'Private GM Roll' : (rollmode == 'blindroll' ? 'Blind GM Roll' : 'Self Roll')));
        //$('.message-mode', html).html(modename);

        //let content = duplicate(message.data.content);
        //content = content.replace('<span class="message-mode"></span>', '<span class="message-mode">' + modename + '</span>');
        //await message.update({ "content": content });
    }
});

Hooks.on("init", () => {
    if (game.system.id == "pf2e") {
        Hooks.on("preCreateChatMessage", (message, option, userid) => {
            if (message?.flags?.pf2e?.context != undefined && (message.flags.pf2e.context?.options?.includes("ignore") || message.flags.pf2e.context.type == 'ignore'))
                return false;
            else
                return true;
        });
    }
});