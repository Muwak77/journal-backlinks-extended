export class JournalLink {
    re = /@(\w+)\[([\w| |\.|#]+(#[-\w]*)?)\]/g;
    

    entityMap = {
    };

    elementSelectors = [
        '.journal-page-content',
        '.editor-content[data-edit="system.description.value"]',
        '.editor-content[data-edit="system.details.biography.value"]',
        '.backlink-window'
    ];    
    classes = [
        'journal-page-content'
    ];

    async updateJournalEntryPage(entity, change) {
        let text = change.text;
        if (text !== undefined) {
            await this.update(entity, 'JournalEntryPage', text.content || '', false);
        } else if (change.flags?.['journal-backlinks-extended']?.['-=sync'] === null) {
            await this.update(entity, 'JournalEntryPage', entity.text.content || '', true);
        }
    }

    // Die Methode zum Zusammenbauen des Contents
    buildContent(fields, change, entity) {
        let content = '';

        // Über die Felder iterieren und die Werte zu `content` hinzufügen
        fields.forEach(field => {
            // Versucht den Wert von change[field] zu nehmen, falls undefined, nimmt entity[field]
            const changeValue = this.getNestedValue(change, field);
            const entityValue = this.getNestedValue(entity, field);
            content += changeValue !== undefined ? changeValue : entityValue || '';
        });

        return content;
    }

    checkForChange(fields, change, entity) {
        let isNew =false;
        
        fields.forEach(field => {
            
            const changeValue = this.getNestedValue(change, field);
            if(changeValue!==undefined) {
                isNew=true;
            }            
        });

        return isNew;
    }

    // Hilfsfunktion, um verschachtelte Werte zu holen
    getNestedValue(obj, path) {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }
    async initNewPage(entity, change) {    
        //Make sure references are not carried over to copies
        await entity.unsetFlag('journal-backlinks-extended', 'referencedBy');
        await entity.unsetFlag('journal-backlinks-extended', 'references');
        await entity.unsetFlag('journal-backlinks-extended', 'sync');
    }
    async updateActor(entity, change) {
        const fields = [
            'system.details.biography.value',
            'system.details.notes.gmdescription',
            'system.details.notes.ownerdescription',
            'system.details.notes.value',
            'system.details.biography.value',
            'system.gmNotes.source',
            'system.notes.source'            
        ];                

        //let content = change.system?.details?.biography?.value;
        let content = this.buildContent(fields, change, entity);

        if(this.checkForChange(fields, change, entity)) {
            await this.update(entity, 'Actor', content || '', false);
        } else if (change.flags?.['journal-backlinks-extended']?.['-=sync'] === null) {
            await this.update(entity, 'Actor', content || '', true);
        }
        
    }

    async updateItem(entity, change) {
        const fields = [            
            'system.description.value',
            'system.gmdescription.value',
            'system.notes.source'                                            
        ];                

        //let content = change.system?.details?.biography?.value;
        let content = this.buildContent(fields, change, entity);

        if(this.checkForChange(fields, change, entity)) {
            await this.update(entity, 'Item', content || '', false);
        } else if (change.flags?.['journal-backlinks-extended']?.['-=sync'] === null) {
            await this.update(entity, 'Item', content || '', true);
        }       
    }

    async update(entity, entityType, content, force) {
        if (!force && !game.settings.get('journal-backlinks-extended', 'rebuildOnSave')) {
            this.log('not updating ' + entityType + ' ' + entity.name + ' as rebuildOnSave is false');
            return;
        }
        this.log('updating ' + entityType + ' ' + entity.name + ' (' + entity.uuid + ')');
        let references = this.references(content);
        let existing = entity.flags['journal-backlinks-extended']?.references || [];

        let updated = [];

        for (let reference of references) {
            if (reference.startsWith('.')) {
                // a local reference, need to reconstruct the global UUID
                reference = entity.uuid.split('.').slice(0, 2).join('.') + '.' + entityType + reference;
            }
            // if we've linked something multiple times in this entity
            if (updated.includes(reference)) {
                this.debug(reference + ' is already updated, skipping');
                continue;
            }
            updated.push(reference);

            if (existing.includes(reference)) {
                this.debug(reference + ' is already referenced, skipping');
                continue;
            }
            
            
            //deprecated, does not work anymore
            //var referenced = game.documentIndex.uuids[reference]?.leaves[0]?.entry;
            
            //Replacement
            var referenced=fromUuidSync(reference);
            if (!referenced) {
                this.debug('no referenced entity ' + reference + '; skipping');
                continue;
            }

            this.debug('adding to referencedBy in ' + referenced.name);
            let links = await referenced.getFlag('journal-backlinks-extended', 'referencedBy') || {};
            let linksOfType = links[entityType] || [];
            if (linksOfType.includes(entity.uuid)) {
                this.debug(entityType + ' ' + entity.uuid + ' already exists, skipping');
                continue;
            }
            linksOfType.push(entity.uuid);

            links[entityType] = linksOfType;
            referenced.setFlag('journal-backlinks-extended', 'referencedBy', duplicate(links));
        }

        for (let outdated of existing.filter(v => !updated.includes(v))) {
                              
            let target =  fromUuidSync(outdated);     
            if (!target) {
                this.debug('outdated entity ' + entityType + ' ' + outdated + ' does not exist');
                continue;
            }

            let links = await target.getFlag('journal-backlinks-extended', 'referencedBy');
            let linksOfType = links[entityType] || [];
            let outdatedIdx = linksOfType.indexOf(entity.uuid);
            if (outdatedIdx > -1) {
                this.debug('removing outdated entity ' + entityType + ' ' + entity.name
                           + ' from ' + target.name);
                linksOfType.splice(outdatedIdx, 1);

                if (linksOfType.length) {
                    links[entityType] = linksOfType;
                } else {
                    delete links[entityType];
                    links['-=' + entityType] = null;
                }

                let copy = duplicate(links);
                await target.setFlag('journal-backlinks-extended', 'referencedBy', copy);
            }
        }
        await entity.setFlag('journal-backlinks-extended', 'references', updated);
    }

    generateBacklinkBox(sheet) {
            const backlinkBox = document.createElement("div");
            backlinkBox.id = "backlink-window"+sheet.id;             
            backlinkBox.classList.add("backlinkBox");            
            backlinkBox.classList.add("chatpaperfield");            
            backlinkBox.style.position = "absolute";
            backlinkBox.style.top = "0"; // Gleiche Höhe wie das Eltern-Element
            backlinkBox.style.left = "calc(100% + 12px)";
            backlinkBox.style.whiteSpace = "nowrap"; // Verhindert Zeilenumbrüche
            backlinkBox.style.backgroundColor = "#000000cc"; // Halbtransparenter weißer Hintergrund
            backlinkBox.style.borderRadius = "4px";         // Abgerundete Ecken mit 4px Radius
            backlinkBox.style.boxShadow = "2px 2px 5px rgba(0, 0, 0, 0.3)"; // Dezenter schwarzer Schatten // Optional: Hintergrundfarbe            
            backlinkBox.style.padding = "10px"; // Optional: Innenabstand für besseren Look
            backlinkBox.style.border = "1px solid black"; // Optional: Rahmen         
            return backlinkBox;
    }

    includeJournalPageLinks(sheet, html, data) {
        this.includeLinks(html, data.document,"journal");
        //this.includeSidebarLink(sheet, html, data) ;//Fix this later
    }

    includeSidebarLink(sheet, html, data) {
    
        const pageEntry =html.parent().parent().parent().parent().parent().find(`.directory-item[data-page-id="${sheet.object.id}"]`);
        

        if(pageEntry.length>0) {
            
        }
        const headingsList = pageEntry.find('ol.headings');
        
        if (headingsList.length) {
            console.log(sheet);
            let links = data.document.flags?.['journal-backlinks-extended']?.['referencedBy'] || {};     
            if (Object.keys(links).length > 0) {
                headingsList.append('<li class="heading h2" data-anchor="backlinks"><a class="heading-link" draggable="true">Backlinks</a></li>');
                const newLink = headingsList.find('[data-anchor="backlinks"] a.heading-link');
                newLink.on('click', function(){
                    const element =$('[data-anchor="extendedbacklinks"]');
                    if ( element ) {
                        element[0].scrollIntoView();
                        return;
                    }
                });
            }

        }
    
    }

    includeActorLinks(sheet, html, data) {
                
        const sheetElement = document.getElementById(sheet.id);            
        const backlinkBox = this.generateBacklinkBox(sheet);
        if (!sheetElement.querySelector('.backlinkBox')) {
        
            sheetElement.appendChild(backlinkBox);
        }
                    
        this.includeLinks(html, data.document,"actor");
    }

    includeItemLinks(sheet, html, data) {
        
        const sheetElement = document.getElementById(sheet.id);            
        const backlinkBox = this.generateBacklinkBox(sheet);
        if (!sheetElement.querySelector('.backlinkBox')) {
            sheetElement.appendChild(backlinkBox);
        }

        this.includeLinks(html, data.document,"item");
    }

    includeLinks(html, entityData,entityType) {
        let displayWindow=false;
        let links = entityData.flags?.['journal-backlinks-extended']?.['referencedBy'] || {};        
        let displayStyle=game.settings.get("journal-backlinks-extended", "displayStyle");
        let valueSet = [];
        let iconSet = [];
        
        //Getting informations from Journal Categories
        try {
            valueSet = (game.settings.get("journal-categories", "valueSet") || "").split(";").map(item => item.trim());
        } catch (error) {
            //console.warn("Fehler beim Abrufen von werteText aus den Einstellungen:", error);
        }
        
        try {
            iconSet = (game.settings.get("journal-categories", "iconSet") || "").split(";").map(icon => icon.trim());
        } catch (error) {
            //console.warn("Fehler beim Abrufen von iconSet aus den Einstellungen:", error);
        }

        if (Object.keys(links).length === 0)
            return;

        this.log('appending links to ' + entityData.name);

        let linksDiv = $('<div class="journal-backlinks"></div>');
        let heading = document.createElement(game.settings.get('journal-backlinks-extended', 'headingTag'));
        heading.append('Linked from');
        $(heading).attr('data-anchor','extendedbacklinks');
        linksDiv.append(heading);
        let linksList = $('<ul class="dsalist"></ul>');
        for (const [type, values] of Object.entries(links)) {
            for (let value of values) {
                
                let entity = fromUuidSync(value);     
                let category;
                try {
                    category = entity.getFlag('journal-categories', 'categoryDropdown') || "-";
                } catch (error) {

                    category = "";
                }
                

                const categoryIndex = valueSet.indexOf(category);
                let icon = iconSet[categoryIndex] || "";
                
                if (!entity) {
                    // this is a bug, but best to try to work around it and log
                        this.log('ERROR | unable to find entity (try the sync button?)');
                    continue;
                }

                if (!entity.testUserPermission(game.users.current, game.settings.get('journal-backlinks-extended', 'minPermission')))
                    continue;
                displayWindow=true;
                this.debug('adding link from ' + type + ' ' + entity.name);
                let link = $('<a class="content-link backlink" draggable="true"></a>');
                link.attr('data-type', type);
                link.attr('data-uuid', value);
                link.attr('data-link', "");
                link.attr('data-id', entity.id);        
                if(icon.length==0) {                                 
                    icon = 'fas ';
                    switch (type) {
                    case 'JournalEntryPage':
                        icon += 'fa-file-lines';
                        break;
                    case 'Actor':
                        icon += 'fa-user';
                        break;
                    case 'Item':
                        icon += 'fa-suitcase';
                        break;
                    case 'RollTable':
                        icon == 'fa-th-list';
                        break;
                    }
                }
                
                link.append($('<i class="' + icon + '"></i>'));
            
                link.append(' ' + entity.name);
                if(type=="JournalEntryPage" && displayStyle=="journalandpage"){

                    
                    link.append(" ("+entity.parent.name+")");
                }
                let p = $('<p></p>');
                p.append(link);

                let li = $('<li></li>');
                li.append(p);
                linksList.append(li);
            }
        }
        linksDiv.append(linksList);        
                    
        if ( entityType=="actor" ||entityType=="item" )                                        
                {
                    if(displayWindow )
                        {
                            let selector="#"+html.id+" .backlinkBox";
                            
                            $(selector).empty().append(linksDiv);                                    
                        }else {
                            $("#" + html[0].id + " .backlinkBox").css("display", "none");
                        }                                        
                }else {
                    let element = this.getElementToModify(html);            
                    if (element !== undefined) {
                        element.append(linksDiv);
                    }
                }
        
    }

    // clears and recreates references
    async sync() {
        this.log('syncing links...');

        let document_types = ['JournalEntryPage', 'Actor'];
        //let document_types = ['JournalEntryPage', 'Actor', 'Item', 'RollTable'];
        let entries = game.documentIndex.lookup('', {
            documentTypes: document_types,
            limit: Number.MAX_SAFE_INTEGER
        });        
        

        for (let type of document_types) {
            this.log('wiping referencedBy for ' + type);
            for (const document of entries[type]) {
                let entity = document.entry;
                if (entity.flags !== undefined) {
                    this.debug('wiping referencedBy for ' + entity.name);
                    await entity.unsetFlag('journal-backlinks-extended', 'referencedBy');
                }
            }
        }

        // this will rebuild the references, so we need to have referencedBy wiped first
        for (let type of document_types) {
            this.log('wiping references and refreshing for ' + type);
            for (const document of entries[type]) {
                let entity = document.entry;
                if (entity.flags !== undefined) {
                    this.debug('wiping references and refreshing for ' + entity.name);
                    await entity.unsetFlag('journal-backlinks-extended', 'references');
                    await entity.unsetFlag('journal-backlinks-extended', 'sync');
                }
            }
        }

        this.log('links synced');
    }

    references(text) {
        return Array.from(text.matchAll(this.re)).map(
            m => {
                let link_type = m[1];
                let link = m[2].replace(/#.*$/, "");
                if (link_type === "UUID") {

                    
                    return link;
                } else {
                    return link_type + "." + link;
                }
            }
        );
    }

    getElementToModify(html) {
        for (let selector of this.elementSelectors) {
            let element = $(html).find(selector);

            if (element.length === 1) {
                return element;
            }
        }

        // nothing in the children, check if this is the element
        for (let c of this.classes) {
            if (html.hasClass(c)) {
                return html.parent();
            }
        }


        this.log('ERROR | unable to find element to modify');
        return undefined;
    }

    log(text) {
        console.log('journal-backlinks | ' + text);
    }

    debug(text) {
        if (CONFIG.debug.JournalLinks)
            this.log('DEBUG | ' + text);
    }
}
